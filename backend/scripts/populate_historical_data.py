#!/usr/bin/env python3
"""
Historical Data Population Script
Fetches historical market data from Yahoo Finance (2000-present) and populates the database.
"""

import yfinance as yf
import psycopg2
from datetime import datetime, timedelta
import pandas as pd
import os
from dotenv import load_dotenv
import sys
import time

# Load environment variables
load_dotenv()

# Database configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://username:password@localhost:5432/inwest_db')

# Clean up the URL for psycopg2 (remove schema parameter if present)
if '?schema=' in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split('?schema=')[0]

# Popular stocks to fetch data for
SYMBOLS = [
    # Tech Giants
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'NFLX',
    
    # Financial
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BRK-B',
    
    # Healthcare
    'JNJ', 'PFE', 'UNH', 'ABBV', 'MRK', 'TMO', 'ABT',
    
    # Consumer
    'PG', 'KO', 'PEP', 'WMT', 'HD', 'MCD', 'NKE', 'SBUX',
    
    # Industrial
    'BA', 'CAT', 'GE', 'MMM', 'HON', 'UPS', 'LMT',
    
    # Energy
    'XOM', 'CVX', 'COP', 'SLB', 'EOG',
    
    # Telecom
    'VZ', 'T', 'TMUS',
    
    # Utilities
    'NEE', 'DUK', 'SO', 'AEP',
    
    # Real Estate
    'AMT', 'PLD', 'CCI', 'EQIX',
    
    # ETFs
    'SPY', 'QQQ', 'IWM', 'VTI', 'VOO'
]

def connect_to_database():
    """Connect to PostgreSQL database"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

def clear_existing_data(conn):
    """Clear existing market data from database"""
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM \"MarketData\"")
        conn.commit()
        print("✅ Cleared existing market data")
    except Exception as e:
        print(f"❌ Error clearing existing data: {e}")
        conn.rollback()

def fetch_historical_data(symbol, start_date="2000-01-01"):
    """Fetch historical data for a symbol from Yahoo Finance"""
    try:
        print(f"📊 Fetching data for {symbol}...")
        
        # Create ticker object
        ticker = yf.Ticker(symbol)
        
        # Fetch historical data
        hist = ticker.history(start=start_date, end=datetime.now().strftime('%Y-%m-%d'))
        
        if hist.empty:
            print(f"⚠️  No data found for {symbol}")
            return None
            
        # Reset index to get date as a column
        hist.reset_index(inplace=True)
        
        # Add symbol column
        hist['Symbol'] = symbol
        
        print(f"✅ Fetched {len(hist)} records for {symbol}")
        return hist
        
    except Exception as e:
        print(f"❌ Error fetching data for {symbol}: {e}")
        return None

def insert_data_to_database(conn, data, symbol):
    """Insert historical data into database"""
    try:
        cursor = conn.cursor()
        
        # Prepare insert query
        insert_query = """
        INSERT INTO "MarketData" (symbol, date, open, close, high, low, volume, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """
        
        # Prepare data for insertion
        records = []
        for _, row in data.iterrows():
            records.append((
                symbol,
                row['Date'].date(),  # Convert to date
                float(row['Open']),
                float(row['Close']),
                float(row['High']),
                float(row['Low']),
                int(row['Volume']),
                'Yahoo Finance'
            ))
        
        # Execute batch insert
        cursor.executemany(insert_query, records)
        conn.commit()
        
        print(f"✅ Inserted {len(records)} records for {symbol}")
        
    except Exception as e:
        print(f"❌ Error inserting data for {symbol}: {e}")
        conn.rollback()

def main():
    """Main function to populate historical data"""
    print("🚀 Starting historical data population...")
    print(f"📅 Fetching data from 2000-01-01 to {datetime.now().strftime('%Y-%m-%d')}")
    print(f"📈 Processing {len(SYMBOLS)} symbols")
    print("-" * 60)
    
    # Connect to database
    conn = connect_to_database()
    
    try:
        # Clear existing data
        clear_existing_data(conn)
        
        # Process each symbol
        total_records = 0
        successful_symbols = 0
        
        for i, symbol in enumerate(SYMBOLS, 1):
            print(f"\n[{i}/{len(SYMBOLS)}] Processing {symbol}...")
            
            # Fetch data
            data = fetch_historical_data(symbol)
            
            if data is not None and not data.empty:
                # Insert into database
                insert_data_to_database(conn, data, symbol)
                total_records += len(data)
                successful_symbols += 1
            
            # Add delay to be respectful to Yahoo Finance
            time.sleep(1)
        
        print("\n" + "=" * 60)
        print("📊 SUMMARY")
        print("=" * 60)
        print(f"✅ Successfully processed: {successful_symbols}/{len(SYMBOLS)} symbols")
        print(f"📈 Total records inserted: {total_records:,}")
        print(f"🕒 Average records per symbol: {total_records // successful_symbols if successful_symbols > 0 else 0}")
        
        # Get some statistics
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM "MarketData"')
        db_count = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(DISTINCT symbol) FROM "MarketData"')
        unique_symbols = cursor.fetchone()[0]
        
        cursor.execute('SELECT MIN(date), MAX(date) FROM "MarketData"')
        date_range = cursor.fetchone()
        
        print(f"🗄️  Database now contains: {db_count:,} records")
        print(f"📊 Unique symbols: {unique_symbols}")
        print(f"📅 Date range: {date_range[0]} to {date_range[1]}")
        
    except KeyboardInterrupt:
        print("\n⚠️  Process interrupted by user")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
    finally:
        conn.close()
        print("\n🔒 Database connection closed")

if __name__ == "__main__":
    main() 