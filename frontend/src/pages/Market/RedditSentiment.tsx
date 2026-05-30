import React from 'react';
import RedditAnalyticsDashboard from '../../components/RedditAnalyticsDashboard';
import PageMeta from "../../components/common/PageMeta";

const RedditSentimentPage: React.FC = () => {
  return (
    <>
      <PageMeta 
        title="Reddit Sentiment Analysis | InWest - AI-Powered Market Intelligence" 
        description="AI-powered sentiment analysis of quality Reddit posts (50+ upvotes) from investing communities. Real-time scraping and sentiment scoring."
      />
      
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* AI-Powered Reddit Analytics Dashboard */}
        <RedditAnalyticsDashboard />
      </div>
    </>
  );
};

export default RedditSentimentPage; 