import torch

print("🔍 GPU Detection Test")
print("=" * 30)
print(f"CUDA available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"GPU name: {torch.cuda.get_device_name()}")
    print(f"GPU count: {torch.cuda.device_count()}")
    print(f"Current device: {torch.cuda.current_device()}")
    print("✅ GPU detected and ready for use!")
else:
    print("⚠️  No GPU detected, will use CPU")
    print("This is fine - CPU inference will work perfectly!")

print("=" * 30) 