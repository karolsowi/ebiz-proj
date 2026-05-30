# Historical Data Population Scripts

This directory contains scripts to populate the database with historical market data.

## Setup

1. **Install Python dependencies:**
   ```bash
   pip install -r scripts/requirements.txt
   ```

2. **Set up environment variables:**
   Create a `.env` file in the project root with your database configuration:
   ```
   DATABASE_URL="postgresql://username:password@localhost:5432/inwest_db"
   ```

3. **Ensure your PostgreSQL database is running and accessible.**

## Running the Historical Data Script

The script will:
- Clear all existing market data from the database
- Fetch historical data from Yahoo Finance (2000-present)
- Populate the database with data for 50+ popular stocks and ETFs

```bash
python scripts/populate_historical_data.py
```

## What Data is Fetched

The script fetches data for the following categories:

- **Tech Giants:** AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA, NFLX
- **Financial:** JPM, BAC, WFC, GS, MS, C, BRK-B
- **Healthcare:** JNJ, PFE, UNH, ABBV, MRK, TMO, ABT
- **Consumer:** PG, KO, PEP, WMT, HD, MCD, NKE, SBUX
- **Industrial:** BA, CAT, GE, MMM, HON, UPS, LMT
- **Energy:** XOM, CVX, COP, SLB, EOG
- **Telecom:** VZ, T, TMUS
- **Utilities:** NEE, DUK, SO, AEP
- **Real Estate:** AMT, PLD, CCI, EQIX
- **ETFs:** SPY, QQQ, IWM, VTI, VOO

## Data Structure

Each record includes:
- Symbol
- Date
- Open, High, Low, Close prices
- Volume
- Source (Yahoo Finance)

## Expected Runtime

The script typically takes 5-10 minutes to complete, depending on your internet connection and database performance. It processes approximately 600,000+ historical records.

## Troubleshooting

1. **Database Connection Issues:**
   - Verify your DATABASE_URL is correct
   - Ensure PostgreSQL is running
   - Check firewall settings

2. **Yahoo Finance Rate Limits:**
   - The script includes 1-second delays between requests
   - If you encounter rate limits, the script will continue with other symbols

3. **Memory Issues:**
   - The script processes one symbol at a time to minimize memory usage
   - Large datasets are inserted in batches 