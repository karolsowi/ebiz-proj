#!/usr/bin/env python3
"""
Setup script for Reddit Sentiment Analysis Service
"""

import subprocess
import sys
import os
from pathlib import Path

def run_command(command, description):
    """Run a command and handle errors"""
    print(f"\n🔄 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed:")
        print(f"Error: {e.stderr}")
        return False

def check_python_version():
    """Check if Python version is compatible"""
    if sys.version_info < (3, 8):
        print("❌ Python 3.8 or higher is required")
        return False
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor} detected")
    return True

def check_gpu():
    """Check if CUDA is available"""
    try:
        import torch
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name()
            print(f"✅ GPU detected: {gpu_name}")
            return True
        else:
            print("⚠️  No GPU detected, will use CPU")
            return False
    except ImportError:
        print("⚠️  PyTorch not installed yet, GPU check will be done after installation")
        return False

def create_virtual_environment():
    """Create a virtual environment"""
    if not os.path.exists("venv"):
        return run_command("python -m venv venv", "Creating virtual environment")
    else:
        print("✅ Virtual environment already exists")
        return True

def activate_venv_command():
    """Get the command to activate virtual environment based on OS"""
    if os.name == 'nt':  # Windows
        return "venv\\Scripts\\activate"
    else:  # Unix/Linux/macOS
        return "source venv/bin/activate"

def install_requirements():
    """Install Python requirements"""
    activate_cmd = activate_venv_command()
    if os.name == 'nt':  # Windows
        pip_cmd = "venv\\Scripts\\pip"
    else:  # Unix/Linux/macOS
        pip_cmd = "venv/bin/pip"
    
    return run_command(f"{pip_cmd} install -r requirements.txt", "Installing Python dependencies")

def setup_environment():
    """Setup environment file"""
    env_file = Path(".env")
    env_example = Path("env_example.txt")
    
    if not env_file.exists() and env_example.exists():
        print("\n🔄 Setting up environment file...")
        with open(env_example, 'r') as f:
            content = f.read()
        
        with open(env_file, 'w') as f:
            f.write(content)
        
        print("✅ Created .env file from template")
        print("⚠️  Please edit .env file with your Reddit API credentials")
        return True
    elif env_file.exists():
        print("✅ Environment file already exists")
        return True
    else:
        print("❌ No environment template found")
        return False

def main():
    """Main setup function"""
    print("🚀 Reddit Sentiment Analysis Service Setup")
    print("=" * 50)
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Check GPU
    check_gpu()
    
    # Create virtual environment
    if not create_virtual_environment():
        sys.exit(1)
    
    # Install requirements
    if not install_requirements():
        sys.exit(1)
    
    # Setup environment
    if not setup_environment():
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("🎉 Setup completed successfully!")
    print("\nNext steps:")
    print("1. Edit .env file with your Reddit API credentials")
    print("2. Run the service with: python main.py")
    print("3. Or use the start script: python start.py")
    print("\nFor more information, see the README.md file")

if __name__ == "__main__":
    main() 