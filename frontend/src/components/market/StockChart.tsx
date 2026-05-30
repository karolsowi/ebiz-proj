import { useState } from "react";
import Chart from "react-apexcharts";
import { ApexOptions } from "apexcharts";
import type {
  ApexChartSeries,
  ApexCandlePoint,
  StockChartIndicators,
} from "../../types/chart";
import { mapIndicatorSeries } from "../../types/chart";

interface StockChartProps {
  symbol: string;
  data: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> | null;
  loading: boolean;
  timeframe: string;
  indicators?: StockChartIndicators;
}

export default function StockChart({ symbol, data, loading, timeframe, indicators }: StockChartProps) {
  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const [showEMA20, setShowEMA20] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVWAP, setShowVWAP] = useState(false);
  const [showOBV, setShowOBV] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const [showPatterns, setShowPatterns] = useState(true);
  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-16 h-16 bg-gray-300 dark:bg-gray-600 rounded-full mb-4"></div>
          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-32"></div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No chart data</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            No historical data available for {symbol}
          </p>
        </div>
      </div>
    );
  }

  // Prepare candlestick data
  const candlestickData = data.map(item => ({
    x: new Date(item.date).getTime(),
    y: [item.open, item.high, item.low, item.close]
  }));

  // Prepare volume data
  const volumeData = data.map(item => ({
    x: new Date(item.date).getTime(),
    y: item.volume
  }));

  // Build the series array dynamically based on toggles
  const seriesArr: ApexChartSeries[] = [{
    name: 'Price',
    type: 'candlestick',
    data: candlestickData as ApexCandlePoint[]
  }];

  if (indicators) {
    if (showSMA20 && indicators.sma20) {
      seriesArr.push({
        name: 'SMA 20',
        type: 'line',
        data: mapIndicatorSeries(indicators.sma20, candlestickData)
      });
    }
    if (showSMA50 && indicators.sma50) {
      seriesArr.push({
        name: 'SMA 50',
        type: 'line',
        data: mapIndicatorSeries(indicators.sma50, candlestickData)
      });
    }
    if (showVWAP && indicators.vwap) {
      seriesArr.push({
        name: 'VWAP',
        type: 'line',
        data: mapIndicatorSeries(indicators.vwap, candlestickData)
      });
    }
    if (showEMA20 && indicators.ema20) {
      seriesArr.push({
        name: 'EMA 20',
        type: 'line',
        data: mapIndicatorSeries(indicators.ema20, candlestickData)
      });
    }
    if (showBollinger && indicators.bbUpper && indicators.bbLower) {
      seriesArr.push({
        name: 'BB Upper',
        type: 'line',
        data: mapIndicatorSeries(indicators.bbUpper, candlestickData)
      });
      seriesArr.push({
        name: 'BB Lower',
        type: 'line',
        data: mapIndicatorSeries(indicators.bbLower, candlestickData)
      });
    }
  }

  type ChartAnnotations = NonNullable<ApexOptions['annotations']>;
  const annotations: ChartAnnotations = { yaxis: [], points: [] };
  const yAxisAnnotations = annotations.yaxis ?? [];
  const pointAnnotations = annotations.points ?? [];

  if (indicators) {
    if (showLevels && indicators.supportResistanceLevels) {
      indicators.supportResistanceLevels.forEach((level) => {
        yAxisAnnotations.push({
          y: level.price,
          borderColor: level.type === 'resistance' ? '#EF4444' : '#10B981',
          label: {
            borderColor: level.type === 'resistance' ? '#EF4444' : '#10B981',
            style: { color: '#fff', background: level.type === 'resistance' ? '#EF4444' : '#10B981', fontSize: '10px' },
            text: `${level.type === 'resistance' ? 'RES' : 'SUP'} ${level.strength === 'strong' ? 'S' : 'W'} ($${level.price.toFixed(2)})`
          }
        });
      });
    }

    if (showPatterns && indicators.detectedPatterns) {
      indicators.detectedPatterns.forEach((pattern) => {
        const patternTime = new Date(pattern.date).getTime();
        // Check if data is within bounds
        const dataPoint = data.find(d => new Date(d.date).getTime() === patternTime);
        if (dataPoint) {
          pointAnnotations.push({
            x: patternTime,
            y: pattern.type === 'bullish' ? dataPoint.low : dataPoint.high,
            marker: {
              size: 5,
              fillColor: pattern.type === 'bullish' ? '#10B981' : (pattern.type === 'bearish' ? '#EF4444' : '#F59E0B'),
              strokeColor: '#fff',
            },
            label: {
              borderColor: pattern.type === 'bullish' ? '#10B981' : (pattern.type === 'bearish' ? '#EF4444' : '#F59E0B'),
              offsetY: pattern.type === 'bullish' ? 10 : -20,
              style: {
                color: '#fff',
                background: pattern.type === 'bullish' ? '#10B981' : (pattern.type === 'bearish' ? '#EF4444' : '#F59E0B'),
                fontSize: '10px',
              },
              text: pattern.name
            }
          });
        }
      });
    }
  }

  annotations.yaxis = yAxisAnnotations;
  annotations.points = pointAnnotations;

  const candlestickOptions: ApexOptions = {
    chart: {
      type: 'candlestick',
      height: 350,
      fontFamily: "Outfit, sans-serif",
      toolbar: {
        show: true,
        tools: {
          download: true,
          selection: true,
          zoom: true,
          zoomin: true,
          zoomout: true,
          pan: true,
          reset: true
        }
      },
      background: 'transparent'
    },
    title: {
      text: `${symbol} Candlestick Chart`,
      align: 'left',
      style: {
        fontSize: '16px',
        fontWeight: 'bold',
        color: '#374151'
      }
    },
    xaxis: {
      type: 'datetime',
      labels: {
        style: {
          colors: '#6B7280'
        }
      }
    },
    yaxis: {
      tooltip: {
        enabled: true
      },
      labels: {
        style: {
          colors: '#6B7280'
        },
        formatter: function (value) {
          return '$' + value.toFixed(2);
        }
      }
    },
    grid: {
      borderColor: '#E5E7EB',
      strokeDashArray: 3
    },
    plotOptions: {
      candlestick: {
        colors: {
          upward: '#10B981',
          downward: '#EF4444'
        },
        wick: {
          useFillColor: true
        }
      }
    },
    tooltip: {
      theme: 'light',
      custom: function({ seriesIndex, dataPointIndex, w }) {
        const data = w.globals.initialSeries[seriesIndex].data[dataPointIndex];
        const date = new Date(data.x).toLocaleDateString();
        const [open, high, low, close] = data.y;
        
        // Find the corresponding volume data
        const volumeItem = volumeData.find(v => v.x === data.x);
        const volume = volumeItem ? volumeItem.y : 0;
        
        const formatVolume = (vol: number) => {
          if (vol >= 1000000000) {
            return (vol / 1000000000).toFixed(2) + 'B';
          } else if (vol >= 1000000) {
            return (vol / 1000000).toFixed(2) + 'M';
          } else if (vol >= 1000) {
            return (vol / 1000).toFixed(2) + 'K';
          }
          return vol.toLocaleString();
        };

        // Don't draw complex standard candlestick tooltip if it's a line series point overlay
        if (!w.globals.initialSeries[seriesIndex] || w.globals.initialSeries[seriesIndex].type === 'line' || data.y === undefined || typeof data.y === 'number') {
           const seriesName = w.globals.seriesNames[seriesIndex];
           const val = data.y;
           return `
             <div class="p-2 bg-white border border-gray-200 rounded shadow-sm">
                <div class="font-semibold text-gray-900">${date}</div>
                <div class="text-xs text-gray-600">${seriesName}: <span class="font-medium">$${val?.toFixed ? val.toFixed(2) : val}</span></div>
             </div>
           `;
        }
        
        return `
          <div class="p-3 bg-white border border-gray-200 rounded-lg shadow-lg">
            <div class="font-semibold text-gray-900 mb-2">${date}</div>
            <div class="space-y-1 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-600">Open:</span>
                <span class="font-medium">$${open.toFixed(2)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">High:</span>
                <span class="font-medium text-green-600">$${high.toFixed(2)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Low:</span>
                <span class="font-medium text-red-600">$${low.toFixed(2)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Close:</span>
                <span class="font-medium">$${close.toFixed(2)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Volume:</span>
                <span class="font-medium text-blue-600">${formatVolume(volume)}</span>
              </div>
              <div class="flex justify-between border-t pt-1">
                <span class="text-gray-600">Change:</span>
                <span class="font-medium ${close >= open ? 'text-green-600' : 'text-red-600'}">
                  ${close >= open ? '+' : ''}${(close - open).toFixed(2)} (${(((close - open) / open) * 100).toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>
        `;
      }
    },
    annotations,
    stroke: {
      width: seriesArr.map(s => s.type === 'candlestick' ? 1 : 2) // Candlesticks have thin strokes, lines have thicker
    },
    responsive: [{
      breakpoint: 768,
      options: {
        chart: {
          height: 300
        }
      }
    }]
  };

  const volumeOptions: ApexOptions = {
    chart: {
      type: 'bar',
      height: 150,
      fontFamily: "Outfit, sans-serif",
      toolbar: {
        show: false
      },
      background: 'transparent'
    },
    colors: ['#6366F1'],
    plotOptions: {
      bar: {
        columnWidth: '80%'
      }
    },
    dataLabels: {
      enabled: false
    },
    xaxis: {
      type: 'datetime',
      labels: {
        show: false
      },
      axisBorder: {
        show: false
      },
      axisTicks: {
        show: false
      }
    },
    yaxis: {
      labels: {
        style: {
          colors: '#6B7280'
        },
        formatter: function (value) {
          if (value >= 1000000000) {
            return (value / 1000000000).toFixed(1) + 'B';
          } else if (value >= 1000000) {
            return (value / 1000000).toFixed(1) + 'M';
          } else if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'K';
          }
          return value.toString();
        }
      }
    },
    grid: {
      borderColor: '#E5E7EB',
      strokeDashArray: 3,
      yaxis: {
        lines: {
          show: true
        }
      },
      xaxis: {
        lines: {
          show: false
        }
      }
    },
    tooltip: {
      theme: 'light',
      x: {
        format: 'dd MMM yyyy'
      },
      y: {
        formatter: function (value) {
          if (value >= 1000000000) {
            return (value / 1000000000).toFixed(2) + 'B';
          } else if (value >= 1000000) {
            return (value / 1000000).toFixed(2) + 'M';
          } else if (value >= 1000) {
            return (value / 1000).toFixed(2) + 'K';
          }
          return value.toLocaleString();
        }
      }
    }
  };

  const obvOptions: ApexOptions = {
    chart: {
      type: 'line',
      height: 170,
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      background: 'transparent'
    },
    stroke: { width: 2, curve: 'smooth' },
    colors: ['#F59E0B'],
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime',
      labels: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: '#6B7280' },
        formatter: function (value) {
          if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
          if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
          return value.toFixed(0);
        }
      }
    },
    grid: {
      borderColor: '#E5E7EB',
      strokeDashArray: 3
    },
    tooltip: {
      theme: 'light',
      x: { format: 'dd MMM yyyy' }
    }
  };

  return (
    <div className="space-y-4">
      {/* Toggles Panel */}
      {indicators && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 items-center">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">Overlays:</span>
          
          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showSMA20} onChange={(e) => setShowSMA20(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span>SMA 20</span>
          </label>
          
          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showSMA50} onChange={(e) => setShowSMA50(e.target.checked)} className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
            <span>SMA 50</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showEMA20} onChange={(e) => setShowEMA20(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span>EMA 20</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showBollinger} onChange={(e) => setShowBollinger(e.target.checked)} className="rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
            <span>Bollinger Bands</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showVWAP} onChange={(e) => setShowVWAP(e.target.checked)} className="rounded border-gray-300 text-yellow-600 focus:ring-yellow-500" />
            <span>VWAP</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showOBV} onChange={(e) => setShowOBV(e.target.checked)} className="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
            <span>OBV</span>
          </label>

          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-2"></div>

          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
            <span>S/R Levels</span>
          </label>

          <label className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showPatterns} onChange={(e) => setShowPatterns(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            <span>Patterns</span>
          </label>
        </div>
      )}

      {/* Price Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 relative z-0">
        <Chart
          options={candlestickOptions}
          series={seriesArr}
          type="candlestick"
          height={380}
        />
      </div>

      {/* Volume Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
        <div className="mb-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Volume</h4>
        </div>
        <Chart
          options={volumeOptions}
          series={[{
            name: 'Volume',
            data: volumeData
          }]}
          type="bar"
          height={150}
        />
      </div>

      {/* OBV Chart */}
      {showOBV && indicators?.obv && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
          <div className="mb-2">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">OBV</h4>
          </div>
          <Chart
            options={obvOptions}
            series={[{
              name: 'OBV',
              data: mapIndicatorSeries(indicators.obv, candlestickData)
            }]}
            type="line"
            height={170}
          />
        </div>
      )}

      {/* Chart Info */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded mr-2"></div>
              <span>Bullish (Green)</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded mr-2"></div>
              <span>Bearish (Red)</span>
            </div>
          </div>
          <div>
            Showing {data.length} trading days ({timeframe})
          </div>
        </div>
      </div>
    </div>
  );
} 