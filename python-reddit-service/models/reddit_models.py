from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class RedditPost(BaseModel):
    """Reddit post model"""
    id: str = Field(..., description="Reddit post ID")
    title: str = Field(..., description="Post title")
    selftext: str = Field(default="", description="Post content/body")
    author: str = Field(..., description="Post author username")
    created_utc: float = Field(..., description="Post creation timestamp (UTC)")
    score: int = Field(..., description="Post score (upvotes - downvotes)")
    num_comments: int = Field(..., description="Number of comments")
    url: str = Field(..., description="Post URL")
    subreddit: str = Field(..., description="Subreddit name")
    sentiment_score: float = Field(default=0.0, description="Sentiment score (-1 to 1)")
    sentiment_label: str = Field(default="Neutral", description="Sentiment label")
    upvote_ratio: float = Field(..., description="Upvote ratio (0 to 1)")
    permalink: str = Field(..., description="Reddit permalink")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "abc123",
                "title": "TSLA earnings beat expectations",
                "selftext": "Tesla reported strong Q3 earnings...",
                "author": "investor123",
                "created_utc": 1699123456.0,
                "score": 1247,
                "num_comments": 89,
                "url": "https://reddit.com/r/investing/comments/abc123",
                "subreddit": "investing",
                "sentiment_score": 0.7,
                "sentiment_label": "Bullish",
                "upvote_ratio": 0.89,
                "permalink": "/r/investing/comments/abc123/tsla_earnings"
            }
        }

class SubredditStats(BaseModel):
    """Subreddit statistics model"""
    subreddit: str = Field(..., description="Subreddit name")
    total_posts: int = Field(..., description="Total number of posts")
    avg_sentiment: float = Field(..., description="Average sentiment score")
    bullish_posts: int = Field(..., description="Number of bullish posts")
    bearish_posts: int = Field(..., description="Number of bearish posts")
    neutral_posts: int = Field(..., description="Number of neutral posts")
    total_engagement: int = Field(..., description="Total engagement (score + comments)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "subreddit": "investing",
                "total_posts": 25,
                "avg_sentiment": 0.15,
                "bullish_posts": 12,
                "bearish_posts": 8,
                "neutral_posts": 5,
                "total_engagement": 15420
            }
        }

class RedditApiResponse(BaseModel):
    """Reddit API response model"""
    posts: List[RedditPost] = Field(..., description="List of Reddit posts")
    stats: List[SubredditStats] = Field(..., description="Subreddit statistics")
    
    class Config:
        json_schema_extra = {
            "example": {
                "posts": [
                    {
                        "id": "abc123",
                        "title": "TSLA earnings beat expectations",
                        "selftext": "Tesla reported strong Q3 earnings...",
                        "author": "investor123",
                        "created_utc": 1699123456.0,
                        "score": 1247,
                        "num_comments": 89,
                        "url": "https://reddit.com/r/investing/comments/abc123",
                        "subreddit": "investing",
                        "sentiment_score": 0.7,
                        "sentiment_label": "Bullish",
                        "upvote_ratio": 0.89,
                        "permalink": "/r/investing/comments/abc123/tsla_earnings"
                    }
                ],
                "stats": [
                    {
                        "subreddit": "investing",
                        "total_posts": 25,
                        "avg_sentiment": 0.15,
                        "bullish_posts": 12,
                        "bearish_posts": 8,
                        "neutral_posts": 5,
                        "total_engagement": 15420
                    }
                ]
            }
        }

class SentimentResult(BaseModel):
    """Sentiment analysis result model"""
    text: str = Field(..., description="Analyzed text")
    sentiment_score: float = Field(..., description="Sentiment score (-1 to 1)")
    sentiment_label: str = Field(..., description="Sentiment label")
    confidence: float = Field(..., description="Confidence score (0 to 1)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "text": "This stock is going to the moon!",
                "sentiment_score": 0.8,
                "sentiment_label": "Very Bullish",
                "confidence": 0.95
            }
        } 