import praw
import os
import logging
from typing import List, Optional
from datetime import datetime, timedelta
import asyncio
from concurrent.futures import ThreadPoolExecutor
import re
from collections import Counter

from models.reddit_models import RedditPost, SubredditStats

logger = logging.getLogger(__name__)

class RedditService:
    """Service for fetching and processing Reddit posts"""
    
    def __init__(self):
        self.reddit = None
        self.subreddits = ['investing', 'wallstreetbets', 'crypto', 'stocks', 'stockmarket']
        self.executor = ThreadPoolExecutor(max_workers=4)
        self._initialize_reddit()
    
    def _initialize_reddit(self):
        """Initialize Reddit API client"""
        try:
            self.reddit = praw.Reddit(
                client_id=os.getenv('REDDIT_CLIENT_ID'),
                client_secret=os.getenv('REDDIT_CLIENT_SECRET'),
                user_agent=os.getenv('REDDIT_USER_AGENT'),
                username=os.getenv('REDDIT_USERNAME'),
                password=os.getenv('REDDIT_PASSWORD')
            )
            
            # Test the connection
            self.reddit.user.me()
            logger.info("Reddit API initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Reddit API: {e}")
            raise
    
    async def fetch_posts(self, subreddit: str = "all", time_filter: str = "day", limit: int = 25) -> List[RedditPost]:
        """Fetch posts from specified subreddits"""
        try:
            if subreddit == "all":
                target_subreddits = self.subreddits
            else:
                if subreddit not in self.subreddits:
                    raise ValueError(f"Unsupported subreddit: {subreddit}")
                target_subreddits = [subreddit]
            
            all_posts = []
            posts_per_subreddit = max(1, limit // len(target_subreddits))
            
            # Fetch posts from each subreddit
            for sub in target_subreddits:
                try:
                    posts = await self._fetch_subreddit_posts(sub, time_filter, posts_per_subreddit)
                    all_posts.extend(posts)
                except Exception as e:
                    logger.error(f"Error fetching posts from r/{sub}: {e}")
                    continue
            
            # Sort by score and limit
            all_posts.sort(key=lambda x: x.score, reverse=True)
            return all_posts[:limit]
            
        except Exception as e:
            logger.error(f"Error in fetch_posts: {e}")
            raise
    
    async def _fetch_subreddit_posts(self, subreddit: str, time_filter: str, limit: int) -> List[RedditPost]:
        """Fetch posts from a single subreddit"""
        def _fetch_sync():
            posts = []
            try:
                sub = self.reddit.subreddit(subreddit)
                
                # Map time filters
                time_map = {
                    'hour': 'hour',
                    'day': 'day', 
                    'week': 'week',
                    'month': 'month'
                }
                
                reddit_time_filter = time_map.get(time_filter, 'day')
                
                # Fetch top posts (since hot doesn't take time_filter)
                for submission in sub.top(limit=limit, time_filter=reddit_time_filter):
                    try:
                        # Skip stickied posts
                        if submission.stickied:
                            continue
                        
                        # Skip deleted/removed posts
                        if submission.selftext == '[deleted]' or submission.selftext == '[removed]':
                            continue
                        
                        post = RedditPost(
                            id=submission.id,
                            title=submission.title,
                            selftext=submission.selftext or "",
                            author=str(submission.author) if submission.author else "[deleted]",
                            created_utc=submission.created_utc,
                            score=submission.score,
                            num_comments=submission.num_comments,
                            url=submission.url,
                            subreddit=submission.subreddit.display_name,
                            upvote_ratio=submission.upvote_ratio,
                            permalink=submission.permalink
                        )
                        posts.append(post)
                        
                    except Exception as e:
                        logger.warning(f"Error processing post {submission.id}: {e}")
                        continue
                
                logger.info(f"Fetched {len(posts)} posts from r/{subreddit}")
                return posts
                
            except Exception as e:
                logger.error(f"Error fetching from r/{subreddit}: {e}")
                return []
        
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, _fetch_sync)
    
    async def search_posts(self, query: str, subreddit: Optional[str] = None, limit: int = 25) -> List[RedditPost]:
        """Search for posts by keyword"""
        def _search_sync():
            posts = []
            try:
                if subreddit and subreddit != "all":
                    search_subreddits = [subreddit]
                else:
                    search_subreddits = self.subreddits
                
                for sub_name in search_subreddits:
                    try:
                        sub = self.reddit.subreddit(sub_name)
                        
                        # Search posts
                        for submission in sub.search(query, limit=limit//len(search_subreddits), time_filter='month'):
                            if submission.stickied:
                                continue
                                
                            post = RedditPost(
                                id=submission.id,
                                title=submission.title,
                                selftext=submission.selftext or "",
                                author=str(submission.author) if submission.author else "[deleted]",
                                created_utc=submission.created_utc,
                                score=submission.score,
                                num_comments=submission.num_comments,
                                url=submission.url,
                                subreddit=submission.subreddit.display_name,
                                upvote_ratio=submission.upvote_ratio,
                                permalink=submission.permalink
                            )
                            posts.append(post)
                            
                    except Exception as e:
                        logger.error(f"Error searching r/{sub_name}: {e}")
                        continue
                
                # Sort by relevance (score)
                posts.sort(key=lambda x: x.score, reverse=True)
                return posts[:limit]
                
            except Exception as e:
                logger.error(f"Error in search: {e}")
                return []
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, _search_sync)
    
    async def get_trending_topics(self, time_filter: str = "day") -> List[str]:
        """Extract trending topics from post titles"""
        try:
            # Fetch recent posts
            posts = await self.fetch_posts("all", time_filter, 100)
            
            # Extract keywords from titles
            all_text = " ".join([post.title for post in posts])
            
            # Simple keyword extraction (you could use more sophisticated NLP here)
            words = re.findall(r'\b[A-Z]{2,5}\b', all_text)  # Stock tickers
            words.extend(re.findall(r'\b(?:bitcoin|ethereum|crypto|AI|earnings|fed|market|bull|bear)\b', all_text.lower()))
            
            # Count frequency
            word_counts = Counter(words)
            
            # Return top trending topics
            trending = [word for word, count in word_counts.most_common(10) if count > 2]
            
            return trending
            
        except Exception as e:
            logger.error(f"Error getting trending topics: {e}")
            return []
    
    def calculate_subreddit_stats(self, posts: List[RedditPost]) -> List[SubredditStats]:
        """Calculate statistics for each subreddit"""
        try:
            stats = []
            
            for subreddit in self.subreddits:
                sub_posts = [post for post in posts if post.subreddit.lower() == subreddit.lower()]
                
                if not sub_posts:
                    stats.append(SubredditStats(
                        subreddit=subreddit,
                        total_posts=0,
                        avg_sentiment=0.0,
                        bullish_posts=0,
                        bearish_posts=0,
                        neutral_posts=0,
                        total_engagement=0
                    ))
                    continue
                
                total_posts = len(sub_posts)
                avg_sentiment = sum(post.sentiment_score for post in sub_posts) / total_posts
                
                bullish_posts = len([p for p in sub_posts if p.sentiment_score > 0.15])
                bearish_posts = len([p for p in sub_posts if p.sentiment_score < -0.15])
                neutral_posts = total_posts - bullish_posts - bearish_posts
                
                total_engagement = sum(post.score + post.num_comments for post in sub_posts)
                
                stats.append(SubredditStats(
                    subreddit=subreddit,
                    total_posts=total_posts,
                    avg_sentiment=avg_sentiment,
                    bullish_posts=bullish_posts,
                    bearish_posts=bearish_posts,
                    neutral_posts=neutral_posts,
                    total_engagement=total_engagement
                ))
            
            return stats
            
        except Exception as e:
            logger.error(f"Error calculating stats: {e}")
            return [] 