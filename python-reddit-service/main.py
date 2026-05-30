from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import os
from dotenv import load_dotenv
import logging
from typing import List, Optional
from datetime import datetime, timedelta
import asyncio
from contextlib import asynccontextmanager
from pydantic import BaseModel

from models.reddit_models import RedditPost, SubredditStats, RedditApiResponse
from services.reddit_service import RedditService
from services.sentiment_service import SentimentService
from utils.cache import CacheManager

# Load environment variables
load_dotenv()

MAX_API_BATCH = int(os.getenv("MAX_API_BATCH", "1024"))

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global services
reddit_service = None
sentiment_service = None
cache_manager = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup and cleanup on shutdown"""
    global reddit_service, sentiment_service, cache_manager
    
    logger.info("Starting Reddit Sentiment Analysis Service...")
    
    # Initialize cache first
    cache_manager = CacheManager()
    logger.info("Cache manager initialized")

    # Initialize ML sentiment service (required — fails hard if broken)
    try:
        sentiment_service = SentimentService()
        await sentiment_service.initialize()
        logger.info("Sentiment service initialized")
    except Exception as e:
        logger.error(f"Failed to initialize sentiment model: {e}")
        raise
    
    # Initialize Reddit API client (optional — service runs without it)
    try:
        reddit_service = RedditService()
        logger.info("Reddit service initialized")
    except Exception as e:
        logger.warning(f"Reddit API not available (missing credentials?): {e}")
        logger.warning("ML sentiment endpoint will still work — Reddit fetching disabled.")
        reddit_service = None
    
    yield
    
    logger.info("Shutting down services...")

# Create FastAPI app
app = FastAPI(
    title="Reddit Sentiment Analysis API",
    description="API for analyzing sentiment from Reddit posts in investing-related subreddits",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
cors_origins = os.getenv('CORS_ORIGINS', 'http://localhost:5175').split(',')
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Reddit Sentiment Analysis API",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    try:
        # Check if services are initialized
        services_status = {
            "reddit_service": reddit_service is not None,
            "sentiment_service": sentiment_service is not None and sentiment_service.is_ready(),
            "cache_manager": cache_manager is not None
        }
        
        all_healthy = all(services_status.values())
        
        return {
            "status": "healthy" if all_healthy else "degraded",
            "services": services_status,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

@app.get("/api/reddit/posts", response_model=RedditApiResponse)
async def get_reddit_posts(
    subreddit: str = Query(default="all", description="Subreddit to fetch from (all, investing, wallstreetbets, crypto, stocks, stockmarket)"),
    time_filter: str = Query(default="day", description="Time filter (hour, day, week, month)"),
    limit: int = Query(default=25, ge=1, le=100, description="Number of posts to fetch")
):
    """Fetch Reddit posts with sentiment analysis"""
    try:
        if not reddit_service or not sentiment_service:
            raise HTTPException(status_code=503, detail="Services not initialized")
        
        # Check cache first
        cache_key = f"posts_{subreddit}_{time_filter}_{limit}"
        cached_result = cache_manager.get(cache_key)
        if cached_result:
            logger.info(f"Returning cached result for {cache_key}")
            return cached_result
        
        # Fetch posts from Reddit
        logger.info(f"Fetching posts: subreddit={subreddit}, time_filter={time_filter}, limit={limit}")
        posts = await reddit_service.fetch_posts(subreddit, time_filter, limit)
        
        if not posts:
            return RedditApiResponse(posts=[], stats=[])
        
        # Analyze sentiment
        logger.info(f"Analyzing sentiment for {len(posts)} posts")
        posts_with_sentiment = await sentiment_service.analyze_posts(posts)
        
        # Calculate statistics
        stats = reddit_service.calculate_subreddit_stats(posts_with_sentiment)
        
        result = RedditApiResponse(posts=posts_with_sentiment, stats=stats)
        
        # Cache the result
        cache_manager.set(cache_key, result)
        
        return result
        
    except Exception as e:
        logger.error(f"Error fetching Reddit posts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch Reddit posts: {str(e)}")

@app.get("/api/reddit/trending")
async def get_trending_topics(
    time_filter: str = Query(default="day", description="Time filter (hour, day, week, month)")
):
    """Get trending topics from Reddit posts"""
    try:
        if not reddit_service:
            raise HTTPException(status_code=503, detail="Reddit service not initialized")
        
        cache_key = f"trending_{time_filter}"
        cached_result = cache_manager.get(cache_key)
        if cached_result:
            return cached_result
        
        trending_topics = await reddit_service.get_trending_topics(time_filter)
        
        result = {"topics": trending_topics, "time_filter": time_filter}
        cache_manager.set(cache_key, result, ttl=1800)  # Cache for 30 minutes
        
        return result
        
    except Exception as e:
        logger.error(f"Error fetching trending topics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch trending topics: {str(e)}")

@app.get("/api/reddit/search")
async def search_posts(
    query: str = Query(..., description="Search query"),
    subreddit: Optional[str] = Query(default=None, description="Subreddit to search in"),
    limit: int = Query(default=25, ge=1, le=100, description="Number of posts to return")
):
    """Search Reddit posts by keyword"""
    try:
        if not reddit_service or not sentiment_service:
            raise HTTPException(status_code=503, detail="Services not initialized")
        
        cache_key = f"search_{query}_{subreddit}_{limit}"
        cached_result = cache_manager.get(cache_key)
        if cached_result:
            return cached_result
        
        posts = await reddit_service.search_posts(query, subreddit, limit)
        posts_with_sentiment = await sentiment_service.analyze_posts(posts)
        
        result = {"posts": posts_with_sentiment, "query": query, "count": len(posts_with_sentiment)}
        cache_manager.set(cache_key, result)
        
        return result
        
    except Exception as e:
        logger.error(f"Error searching posts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to search posts: {str(e)}")

@app.get("/api/sentiment/analyze")
async def analyze_text(
    text: str = Query(..., description="Text to analyze"),
):
    """Analyze sentiment of arbitrary text"""
    try:
        if not sentiment_service:
            raise HTTPException(status_code=503, detail="Sentiment service not initialized")
        
        result = await sentiment_service.analyze_text(text)
        return result
        
    except Exception as e:
        logger.error(f"Error analyzing text sentiment: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to analyze sentiment: {str(e)}")

# ── ML Batch Sentiment Endpoint (for Node.js backend integration) ──

class BatchSentimentRequest(BaseModel):
    texts: List[str]

class SentimentScore(BaseModel):
    score: float
    label: str
    confidence: float
    positive: float
    negative: float
    neutral: float
    model: str

class BatchSentimentResponse(BaseModel):
    results: List[SentimentScore]
    model: str
    count: int

@app.post("/api/ml/sentiment", response_model=BatchSentimentResponse)
async def batch_sentiment(request: BatchSentimentRequest):
    """Analyze sentiment for a batch of texts using FinBERT.

    Primary endpoint for Node.js backend integration.
    Batch size capped by MAX_API_BATCH (default 512; tune via env + GPU VRAM).
    """
    try:
        if not sentiment_service or not sentiment_service.is_ready():
            raise HTTPException(status_code=503, detail="ML sentiment service not initialized")

        texts = request.texts
        if len(texts) > MAX_API_BATCH:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {MAX_API_BATCH} texts per request",
            )
        
        if len(texts) == 0:
            return BatchSentimentResponse(results=[], model=sentiment_service.model_name, count=0)
        
        results = await sentiment_service.analyze_texts_batch(texts)
        
        return BatchSentimentResponse(
            results=[SentimentScore(**r) for r in results],
            model=sentiment_service.model_name,
            count=len(results)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in batch sentiment analysis: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to analyze sentiment: {str(e)}")

@app.get("/api/stats")
async def get_service_stats():
    """Get service statistics"""
    try:
        stats = {
            "cache_stats": cache_manager.get_stats() if cache_manager else {},
            "sentiment_model": sentiment_service.get_model_info() if sentiment_service else {},
            "uptime": datetime.utcnow().isoformat(),
        }
        return stats
    except Exception as e:
        logger.error(f"Error getting service stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")

if __name__ == "__main__":
    host = os.getenv('HOST', 'localhost')
    port = int(os.getenv('PORT', 8000))
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level=os.getenv('LOG_LEVEL', 'info').lower()
    ) 