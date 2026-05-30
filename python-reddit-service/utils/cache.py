import time
import os
import logging
from typing import Any, Optional, Dict
import json
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class CacheManager:
    """Simple in-memory cache manager"""
    
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.default_ttl = int(os.getenv('CACHE_TTL', 300))  # 5 minutes default
        self.enabled = os.getenv('ENABLE_CACHE', 'true').lower() == 'true'
        self.stats = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'evictions': 0
        }
        
        logger.info(f"Cache initialized - TTL: {self.default_ttl}s, Enabled: {self.enabled}")
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        if not self.enabled:
            return None
        
        try:
            if key in self.cache:
                entry = self.cache[key]
                
                # Check if expired
                if time.time() > entry['expires_at']:
                    del self.cache[key]
                    self.stats['evictions'] += 1
                    self.stats['misses'] += 1
                    return None
                
                self.stats['hits'] += 1
                return entry['value']
            
            self.stats['misses'] += 1
            return None
            
        except Exception as e:
            logger.error(f"Error getting cache key {key}: {e}")
            self.stats['misses'] += 1
            return None
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set value in cache"""
        if not self.enabled:
            return False
        
        try:
            ttl = ttl or self.default_ttl
            expires_at = time.time() + ttl
            
            self.cache[key] = {
                'value': value,
                'expires_at': expires_at,
                'created_at': time.time()
            }
            
            self.stats['sets'] += 1
            
            # Simple cleanup - remove expired entries if cache gets too large
            if len(self.cache) > 1000:
                self._cleanup_expired()
            
            return True
            
        except Exception as e:
            logger.error(f"Error setting cache key {key}: {e}")
            return False
    
    def delete(self, key: str) -> bool:
        """Delete key from cache"""
        if not self.enabled:
            return False
        
        try:
            if key in self.cache:
                del self.cache[key]
                return True
            return False
            
        except Exception as e:
            logger.error(f"Error deleting cache key {key}: {e}")
            return False
    
    def clear(self) -> bool:
        """Clear all cache entries"""
        try:
            self.cache.clear()
            logger.info("Cache cleared")
            return True
            
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return False
    
    def _cleanup_expired(self):
        """Remove expired entries from cache"""
        try:
            current_time = time.time()
            expired_keys = [
                key for key, entry in self.cache.items()
                if current_time > entry['expires_at']
            ]
            
            for key in expired_keys:
                del self.cache[key]
                self.stats['evictions'] += 1
            
            if expired_keys:
                logger.info(f"Cleaned up {len(expired_keys)} expired cache entries")
                
        except Exception as e:
            logger.error(f"Error during cache cleanup: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        total_requests = self.stats['hits'] + self.stats['misses']
        hit_rate = (self.stats['hits'] / total_requests * 100) if total_requests > 0 else 0
        
        return {
            'enabled': self.enabled,
            'total_entries': len(self.cache),
            'hits': self.stats['hits'],
            'misses': self.stats['misses'],
            'sets': self.stats['sets'],
            'evictions': self.stats['evictions'],
            'hit_rate_percent': round(hit_rate, 2),
            'default_ttl': self.default_ttl
        }
    
    def get_info(self) -> Dict[str, Any]:
        """Get detailed cache information"""
        current_time = time.time()
        
        # Count entries by expiration status
        active_entries = 0
        expired_entries = 0
        
        for entry in self.cache.values():
            if current_time > entry['expires_at']:
                expired_entries += 1
            else:
                active_entries += 1
        
        return {
            **self.get_stats(),
            'active_entries': active_entries,
            'expired_entries': expired_entries,
            'memory_usage_estimate': len(str(self.cache))  # Rough estimate
        } 