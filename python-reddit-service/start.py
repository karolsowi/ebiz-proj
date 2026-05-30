#!/usr/bin/env python3
"""
Start script for Reddit Sentiment Analysis Service
"""

import os
import sys
import subprocess
from pathlib import Path

def check_environment():
    """Check if environment is properly set up"""
    env_file = Path(".env")
    if not env_file.exists():
        print("ERROR: .env file not found!")
        print("Please run 'python setup.py' first or create .env file manually")
        return False
    
    # Check if virtual environment exists
    venv_path = Path("venv")
    if not venv_path.exists():
        print("ERROR: Virtual environment not found!")
        print("Please run 'python setup.py' first")
        return False
    
    return True

def start_service():
    """Start the FastAPI service"""
    if not check_environment():
        sys.exit(1)
    
    print("Starting Reddit Sentiment Analysis Service...")
    
    # Determine the correct python executable
    if os.name == 'nt':  # Windows
        python_exe = "venv\\Scripts\\python.exe"
    else:  # Unix/Linux/macOS
        python_exe = "venv/bin/python"
    
    try:
        # Start the service
        subprocess.run([python_exe, "main.py"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Failed to start service: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nService stopped by user")
        sys.exit(0)

if __name__ == "__main__":
    start_service() 