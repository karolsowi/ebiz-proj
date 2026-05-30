import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline
import os
import logging
from typing import List, Dict, Any, Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

from models.reddit_models import RedditPost, SentimentResult

logger = logging.getLogger(__name__)


def _resolve_torch_dtype(device: str) -> torch.dtype:
    """auto = fp16 on CUDA (fits large batches on 12–24GB VRAM), fp32 on CPU."""
    raw = os.getenv("TORCH_DTYPE", "auto").strip().lower()
    if raw in ("float32", "fp32"):
        return torch.float32
    if raw in ("bfloat16", "bf16"):
        return torch.bfloat16
    if raw in ("float16", "fp16"):
        return torch.float16
    return torch.float16 if device == "cuda" else torch.float32


class SentimentService:
    """Service for analyzing sentiment using FinBERT (financial domain-specific model)"""
    
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.sentiment_pipeline = None
        self.device = None
        self.torch_dtype: Optional[torch.dtype] = None
        self.backend = os.getenv('INFERENCE_BACKEND', 'torch').strip().lower()
        self.enable_autocast = os.getenv('ENABLE_AUTOMATIC_MIXED_PRECISION', 'true').strip().lower() in ('1', 'true', 'yes')
        # Default to FinBERT — trained on financial text, produces positive/negative/neutral
        self.model_name = os.getenv('SENTIMENT_MODEL', 'ProsusAI/finbert')
        self.max_length = int(os.getenv('MAX_LENGTH', 512))
        self.max_batch_tokens = int(os.getenv('MAX_BATCH_TOKENS', '32768'))
        self.max_batch_size_cap = int(os.getenv('MAX_BATCH_SIZE_CAP', '2048'))
        self.executor = ThreadPoolExecutor(max_workers=int(os.getenv('INFERENCE_POOL_WORKERS', 2)))

        # Determine device first — BATCH_SIZE defaults are higher on GPU (e.g. 24GB VRAM)
        device_env = os.getenv('DEVICE', 'cuda').lower()
        if device_env == 'cuda' and torch.cuda.is_available():
            self.device = 'cuda'
            torch.backends.cuda.matmul.allow_tf32 = True
            try:
                torch.backends.cudnn.benchmark = True
            except Exception:
                pass
            logger.info(f"Using GPU: {torch.cuda.get_device_name(0)} "
                        f"({torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB total)")
            default_bs = os.getenv('BATCH_SIZE_DEFAULT_GPU', '96')
            self.batch_size = int(os.getenv('BATCH_SIZE', default_bs))
        else:
            self.device = 'cpu'
            self.batch_size = int(os.getenv('BATCH_SIZE', '16'))
            if device_env == 'cuda':
                logger.warning(
                    "DEVICE=cuda but torch.cuda.is_available() is false — "
                    "using CPU (install CUDA PyTorch from pytorch.org/get-started)."
                )
            logger.info("Using CPU for inference")
    
    async def initialize(self):
        """Initialize the FinBERT sentiment analysis model"""
        try:
            logger.info(f"Loading sentiment model: {self.model_name}")
            self.torch_dtype = _resolve_torch_dtype(self.device)
            logger.info(f"Inference dtype: {self.torch_dtype}")
            logger.info(f"Inference backend: {self.backend}")

            def _load_model():
                tokenizer = AutoTokenizer.from_pretrained(self.model_name)
                if self.backend == 'onnx':
                    try:
                        # Optional dependency path for high-throughput optimized inference.
                        from optimum.onnxruntime import ORTModelForSequenceClassification
                        model = ORTModelForSequenceClassification.from_pretrained(
                            self.model_name,
                            export=True,
                            provider='CUDAExecutionProvider' if self.device == 'cuda' else 'CPUExecutionProvider',
                        )
                        sentiment_pipe = pipeline(
                            "sentiment-analysis",
                            model=model,
                            tokenizer=tokenizer,
                            device=0 if self.device == 'cuda' else -1,
                            top_k=None,
                            max_length=self.max_length,
                            truncation=True,
                        )
                        logger.info("Loaded ONNX Runtime backend (optimum)")
                        return model, tokenizer, sentiment_pipe
                    except Exception as onnx_error:
                        logger.warning(f"Failed to load ONNX backend, falling back to torch: {onnx_error}")
                        self.backend = 'torch'

                load_kw: Dict[str, Any] = {}
                if self.torch_dtype in (torch.float16, torch.bfloat16):
                    load_kw["torch_dtype"] = self.torch_dtype
                model = AutoModelForSequenceClassification.from_pretrained(
                    self.model_name,
                    **load_kw,
                )
                model = model.to(self.device)
                model.eval()

                sentiment_pipe = pipeline(
                    "sentiment-analysis",
                    model=model,
                    tokenizer=tokenizer,
                    device=0 if self.device == 'cuda' else -1,
                    top_k=None,
                    max_length=self.max_length,
                    truncation=True,
                )

                return model, tokenizer, sentiment_pipe
            
            # Load in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            self.model, self.tokenizer, self.sentiment_pipeline = await loop.run_in_executor(
                self.executor, _load_model
            )
            
            logger.info(f"FinBERT model loaded successfully on {self.device}")
            
        except Exception as e:
            logger.error(f"Failed to initialize sentiment model: {e}")
            raise
    
    def is_ready(self) -> bool:
        """Check if the service is ready"""
        return self.model is not None and self.sentiment_pipeline is not None
    
    async def analyze_posts(self, posts: List[RedditPost]) -> List[RedditPost]:
        """Analyze sentiment for a list of Reddit posts"""
        if not self.is_ready():
            raise RuntimeError("Sentiment service not initialized")
        
        try:
            texts = []
            for post in posts:
                combined_text = f"{post.title} {post.selftext}".strip()
                if len(combined_text) > self.max_length * 4:
                    combined_text = combined_text[:self.max_length * 4]
                texts.append(combined_text)
            
            sentiment_results = await self._analyze_batch(texts)
            
            updated_posts = []
            for post, sentiment in zip(posts, sentiment_results):
                post.sentiment_score = sentiment['score']
                post.sentiment_label = sentiment['label']
                updated_posts.append(post)
            
            return updated_posts
            
        except Exception as e:
            logger.error(f"Error analyzing post sentiment: {e}")
            raise
    
    async def analyze_text(self, text: str) -> SentimentResult:
        """Analyze sentiment of arbitrary text"""
        if not self.is_ready():
            raise RuntimeError("Sentiment service not initialized")
        
        try:
            results = await self._analyze_batch([text])
            result = results[0]
            
            return SentimentResult(
                text=text,
                sentiment_score=result['score'],
                sentiment_label=result['label'],
                confidence=result['confidence']
            )
            
        except Exception as e:
            logger.error(f"Error analyzing text sentiment: {e}")
            raise
    
    async def analyze_texts_batch(self, texts: List[str]) -> List[Dict[str, Any]]:
        """Analyze sentiment for a batch of texts — primary API for external callers"""
        if not self.is_ready():
            raise RuntimeError("Sentiment service not initialized")
        
        return await self._analyze_batch(texts)
    
    async def _analyze_batch(self, texts: List[str]) -> List[Dict[str, Any]]:
        """Analyze sentiment for a batch of texts using FinBERT"""
        def _make_dynamic_batches(input_texts: List[str]) -> List[List[str]]:
            """
            Dynamic batching by token budget.
            Keeps GPU fuller on short texts and prevents OOM on long texts.
            """
            if not input_texts:
                return []

            batches: List[List[str]] = []
            current_batch: List[str] = []
            current_tokens = 0

            # Fast approximate tokenization length (no special tokens needed for budgeting).
            token_lengths = self.tokenizer(
                input_texts,
                add_special_tokens=False,
                truncation=True,
                max_length=self.max_length,
            )["input_ids"]

            for text, ids in zip(input_texts, token_lengths):
                token_len = min(len(ids), self.max_length)
                if token_len <= 0:
                    token_len = 1

                would_exceed_tokens = (current_tokens + token_len) > self.max_batch_tokens
                would_exceed_items = len(current_batch) >= min(self.batch_size, self.max_batch_size_cap)

                if current_batch and (would_exceed_tokens or would_exceed_items):
                    batches.append(current_batch)
                    current_batch = []
                    current_tokens = 0

                current_batch.append(text)
                current_tokens += token_len

            if current_batch:
                batches.append(current_batch)

            return batches

        def _analyze_sync():
            try:
                all_results = []

                # Truncate very long raw inputs before tokenization/inference.
                preprocessed = []
                for text in texts:
                    if len(text) > 2000:
                        text = text[:2000]
                    preprocessed.append(text)

                batches = _make_dynamic_batches(preprocessed)

                for batch in batches:
                    if (
                        self.device == 'cuda'
                        and self.backend == 'torch'
                        and self.enable_autocast
                        and self.torch_dtype in (torch.float16, torch.bfloat16)
                    ):
                        with torch.inference_mode():
                            with torch.autocast(device_type='cuda', dtype=self.torch_dtype):
                                batch_results = self.sentiment_pipeline(batch)
                    else:
                        with torch.inference_mode():
                            batch_results = self.sentiment_pipeline(batch)
                    
                    # Process results
                    for result in batch_results:
                        processed = self._process_finbert_result(result)
                        all_results.append(processed)
                
                return all_results
                
            except Exception as e:
                logger.error(f"Error in batch sentiment analysis: {e}")
                return [{'score': 0.0, 'label': 'neutral', 'confidence': 0.0} for _ in texts]
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, _analyze_sync)
    
    def _process_finbert_result(self, result: List[Dict]) -> Dict[str, Any]:
        """Process FinBERT output into standardized format
        
        FinBERT outputs: [
            {'label': 'positive', 'score': 0.85},
            {'label': 'negative', 'score': 0.10},
            {'label': 'neutral', 'score': 0.05}
        ]
        """
        try:
            # Build score map from all labels
            score_map = {}
            for item in result:
                label = item['label'].lower()
                score_map[label] = item['score']
            
            positive_score = score_map.get('positive', 0.0)
            negative_score = score_map.get('negative', 0.0)
            neutral_score = score_map.get('neutral', 0.0)
            
            # Find dominant label
            best = max(result, key=lambda x: x['score'])
            raw_label = best['label'].lower()
            confidence = best['score']
            
            # Calculate continuous sentiment score (-1 to 1)
            # Positive contributes +score, negative contributes -score
            sentiment_score = positive_score - negative_score
            
            # Map to financial labels
            if sentiment_score > 0.3:
                label = 'very_bullish' if confidence > 0.8 else 'bullish'
            elif sentiment_score > 0.05:
                label = 'bullish'
            elif sentiment_score < -0.3:
                label = 'very_bearish' if confidence > 0.8 else 'bearish'
            elif sentiment_score < -0.05:
                label = 'bearish'
            else:
                label = 'neutral'
            
            return {
                'score': round(sentiment_score, 4),
                'label': label,
                'confidence': round(confidence, 4),
                'positive': round(positive_score, 4),
                'negative': round(negative_score, 4),
                'neutral': round(neutral_score, 4),
                'model': self.model_name
            }
            
        except Exception as e:
            logger.error(f"Error processing FinBERT result: {e}")
            return {
                'score': 0.0, 'label': 'neutral', 'confidence': 0.0,
                'positive': 0.0, 'negative': 0.0, 'neutral': 1.0,
                'model': self.model_name
            }
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the loaded model"""
        if not self.is_ready():
            return {}
        
        return {
            'model_name': self.model_name,
            'backend': self.backend,
            'device': self.device,
            'torch_dtype': str(self.torch_dtype) if self.torch_dtype else None,
            'automatic_mixed_precision': self.enable_autocast,
            'max_length': self.max_length,
            'batch_size': self.batch_size,
            'max_batch_tokens': self.max_batch_tokens,
            'max_batch_size_cap': self.max_batch_size_cap,
            'gpu_available': torch.cuda.is_available(),
            'gpu_name': torch.cuda.get_device_name() if torch.cuda.is_available() else None,
            'cuda_mem_allocated_gb': round(torch.cuda.memory_allocated(0) / 1e9, 3) if self.device == 'cuda' else None,
        }