# Reddit Sentiment Analysis Service

A high-performance Python service that fetches Reddit posts from investing-related subreddits and analyzes sentiment using local AI models with GPU acceleration.

## Features

- 🚀 **Real Reddit Data**: Fetches live posts from Reddit API using PRAW
- 🤖 **Local AI Sentiment Analysis**: Uses transformer models with GPU acceleration
- 📊 **Multiple Subreddits**: Monitors r/investing, r/wallstreetbets, r/crypto, r/stocks, r/stockmarket
- ⚡ **High Performance**: Batch processing with caching for optimal performance
- 🔄 **RESTful API**: FastAPI-based service with automatic documentation
- 💾 **Smart Caching**: In-memory caching to reduce API calls and improve response times
- 🎯 **Flexible Filtering**: Filter by subreddit, time period, and search keywords

## Requirements

- Python 3.8+
- NVIDIA GPU (recommended) or CPU
- Reddit API credentials
- 4GB+ RAM (8GB+ recommended for GPU inference)

## Quick Start

### 1. Setup

```bash
# Clone or navigate to the python-reddit-service directory
cd python-reddit-service

# Run the setup script
python setup.py
```

### 2. Configure Reddit API

1. Go to https://www.reddit.com/prefs/apps/
2. Create a new "script" application
3. Note down your client ID and client secret
4. Edit `.env` file with your credentials:

```env
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
REDDIT_USER_AGENT=YourAppName/1.0.0 by YourUsername
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
```

### 3. Run the Service

```bash
# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Start the service
python main.py
```

The service will be available at `http://localhost:8000`

## API Endpoints

### Health Check
- `GET /health` - Service health status
- `GET /` - Basic service info

### Reddit Data
- `GET /api/reddit/posts` - Fetch posts with sentiment analysis
  - Parameters: `subreddit`, `time_filter`, `limit`
- `GET /api/reddit/search` - Search posts by keyword
  - Parameters: `query`, `subreddit`, `limit`
- `GET /api/reddit/trending` - Get trending topics
  - Parameters: `time_filter`

### Sentiment Analysis
- `GET /api/sentiment/analyze` - Analyze arbitrary text
  - Parameters: `text`

### Service Stats
- `GET /api/stats` - Get service statistics and model info

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDDIT_CLIENT_ID` | - | Reddit API client ID |
| `REDDIT_CLIENT_SECRET` | - | Reddit API client secret |
| `REDDIT_USER_AGENT` | - | Reddit API user agent |
| `REDDIT_USERNAME` | - | Reddit username |
| `REDDIT_PASSWORD` | - | Reddit password |
| `HOST` | localhost | Server host |
| `PORT` | 8000 | Server port |
| `CORS_ORIGINS` | localhost:5175 | Allowed CORS origins |
| `SENTIMENT_MODEL` | ProsusAI/finbert | HuggingFace model id |
| `DEVICE` | cuda | Inference device (`cuda` / `cpu`) |
| `INFERENCE_BACKEND` | torch | `torch` (HF/PyTorch) or `onnx` (Optimum + ONNX Runtime) |
| `TORCH_DTYPE` | auto | `auto` = float16 on GPU, `float32`, `bfloat16` |
| `ENABLE_AUTOMATIC_MIXED_PRECISION` | true | Enable CUDA autocast (FP16/BF16 mixed precision) during inference |
| `BATCH_SIZE` | 96 (GPU) / 16 (CPU) | FinBERT micro-batch size inside the service; raise on 24GB until OOM, then edge down |
| `MAX_BATCH_TOKENS` | 32768 | Dynamic token-budget per micro-batch (higher = more throughput, higher VRAM usage) |
| `MAX_BATCH_SIZE_CAP` | 2048 | Hard cap on dynamic micro-batch item count |
| `MAX_API_BATCH` | 1024 | Max sequences per `/api/ml/sentiment` request (raise to 2048 on strong GPUs) |
| `INFERENCE_POOL_WORKERS` | 2 | ThreadPool workers for blocking `transformers` calls |
| `MAX_LENGTH` | 512 | Max text length for analysis |
| `CACHE_TTL` | 300 | Cache TTL in seconds |
| `ENABLE_CACHE` | true | Enable/disable caching |
| `LOG_LEVEL` | INFO | Logging level |

### Sentiment Models

The service uses transformer models from HuggingFace. Recommended models:

- `ProsusAI/finbert` (default — financial-domain FinBERT)
- `cardiffnlp/twitter-roberta-base-sentiment-latest`
- `nlptown/bert-base-multilingual-uncased-sentiment`

## Performance Optimization

### High-VRAM GPUs (e.g. 24 GB)

1. Copy [.env.gpu.example](.env.gpu.example) hints into `.env`.
2. Use `DEVICE=cuda`, leave `TORCH_DTYPE=auto`, and set `ENABLE_AUTOMATIC_MIXED_PRECISION=true`.
3. Increase `BATCH_SIZE` gradually (try **128**, then **192**); if CUDA OOMs, lower batch or `MAX_BATCH_TOKENS`.
4. Raise `MAX_API_BATCH` to **1024** (or **2048** on very strong GPUs) and match backend `ML_MAX_TEXTS_PER_REQUEST`.
5. Tune dynamic batching:
   - `MAX_BATCH_TOKENS` controls token budget per micro-batch.
   - `MAX_BATCH_SIZE_CAP` prevents oversized item counts on very short texts.

### ONNX Runtime Backend (Optional)

For lower latency and better hardware utilization, you can run ONNX Runtime:

1. Install dependencies from `requirements.txt` (includes `onnxruntime-gpu` and `optimum[onnxruntime]`).
2. Set:
   - `INFERENCE_BACKEND=onnx`
   - `DEVICE=cuda`
3. On first run, the model is exported to ONNX automatically by Optimum (`export=True`) and reused.
4. If ONNX init fails, service automatically falls back to `torch` backend.

### Caching
- In-memory caching with configurable TTL
- Reduces Reddit API calls
- Improves response times for repeated requests

### Batch Processing
- Processes multiple posts simultaneously
- Configurable batch size based on GPU memory
- Efficient memory management

## Integration with React App

The React app automatically connects to this service. Configure the connection:

```env
# In your React app's .env file
REACT_APP_PYTHON_API_URL=http://localhost:8000
```

The React service includes fallback to mock data if the Python service is unavailable.

## Monitoring

### Health Checks
```bash
curl http://localhost:8000/health
```

### Service Statistics
```bash
curl http://localhost:8000/api/stats
```

### Logs
The service provides detailed logging with configurable levels:
- ERROR: Critical errors only
- WARNING: Warnings and errors
- INFO: General information (default)
- DEBUG: Detailed debugging information

## Troubleshooting

### Common Issues

1. **Reddit API Authentication Failed**
   - Verify credentials in `.env` file
   - Check Reddit app configuration
   - Ensure user agent is descriptive

2. **GPU Not Detected**
   - Install CUDA toolkit
   - Verify PyTorch CUDA installation: `python -c "import torch; print(torch.cuda.is_available())"`
   - Set `DEVICE=cpu` in `.env` to force CPU usage

3. **Model Download Issues**
   - Ensure internet connection
   - Models are downloaded on first run
   - Check HuggingFace model availability

4. **Memory Issues**
   - Reduce `BATCH_SIZE` in `.env`
   - Use smaller model
   - Increase system RAM/VRAM

### Performance Tips

1. **GPU Memory**
   - Monitor GPU memory usage
   - Adjust batch size based on available VRAM
   - Use mixed precision if supported

2. **API Rate Limits**
   - Reddit has rate limits (60 requests/minute)
   - Service includes automatic rate limiting
   - Increase cache TTL to reduce API calls

3. **Model Loading**
   - Models are loaded once at startup
   - First request may be slower due to model initialization
   - Consider model warm-up for production

## Development

### Project Structure
```
python-reddit-service/
├── main.py                 # FastAPI application
├── models/
│   └── reddit_models.py    # Pydantic models
├── services/
│   ├── reddit_service.py   # Reddit API integration
│   └── sentiment_service.py # AI sentiment analysis
├── utils/
│   └── cache.py           # Caching utilities
├── requirements.txt       # Python dependencies
├── setup.py              # Setup script
└── README.md             # This file
```

### Adding New Features

1. **New Endpoints**: Add to `main.py`
2. **New Models**: Add to `models/reddit_models.py`
3. **New Services**: Add to `services/` directory
4. **New Utilities**: Add to `utils/` directory

### Testing

```bash
# Install test dependencies
pip install pytest pytest-asyncio httpx

# Run tests
pytest
```

## License

This project is part of the investment app and follows the same license terms.

## Support

For issues and questions:
1. Check this README
2. Review logs for error messages
3. Verify configuration
4. Check Reddit API status 