import {
  tradingAccounts,
  orders,
  positions,
  tradeExecutions,
  tradingSessions,
  tradingRiskSettings,
  users,
} from '../db/schema';
import { createHash, randomUUID } from 'crypto';
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import type AlpacaApiService from './alpacaApi.js';
import { type CreateOrderRequest } from './alpacaApi.js';
import { getAlpacaClientForUser, hasUserIntegrationKeys } from './credentialResolver.js';

export interface TradeOrder {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  qty: string;
  limit_price?: string;
  stop_price?: string;
  extended_hours?: boolean;
  client_order_id?: string;
}

export interface TradeHistoryFilter {
  startDate?: Date;
  endDate?: Date;
  symbol?: string;
  side?: 'buy' | 'sell';
  status?: string;
  limit?: number;
  offset?: number;
  page?: number;
}

export interface TradingStats {
  totalTrades: number;
  successfulTrades: number;
  totalPL: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  dayTradeCount: number;
  realizedPL: number;
  unrealizedPL: number;
}

export interface RiskSettings {
  maxPositionSizePercent: number;
  dailyLossLimit: number;
  perTradeRiskPercent: number;
}

export interface RiskViolation {
  code: 'MAX_POSITION_SIZE' | 'DAILY_LOSS_LIMIT' | 'PER_TRADE_RISK';
  message: string;
}

class RiskViolationError extends Error {
  public readonly violations: RiskViolation[];
  constructor(violations: RiskViolation[]) {
    super(violations.map(v => v.message).join(' | '));
    this.name = 'RiskViolationError';
    this.violations = violations;
  }
}

class TradingService {
  private defaultAccountExternalId = 'paper-default';

  private getUserAccountExternalId(userId: string): string {
    return `${userId}:${this.defaultAccountExternalId}`;
  }

  /**
   * When ALPACA_ORDER_SYNC_USER_EMAIL or ALPACA_ORDER_SYNC_USER_ID is set, only that user
   * receives Alpaca sync (orders, fills, account snapshot). Others keep per-user DB rows only.
   * When neither is set, any user may sync (dev / single-user installs).
   */
  private async isAlpacaBrokerSyncUser(userId: string): Promise<boolean> {
    const idEnv = process.env.ALPACA_ORDER_SYNC_USER_ID?.trim();
    const emailEnv = process.env.ALPACA_ORDER_SYNC_USER_EMAIL?.trim().toLowerCase();

    if (!idEnv && !emailEnv) {
      return true;
    }

    if (idEnv && userId === idEnv) {
      return true;
    }

    if (emailEnv) {
      const row = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const em = row[0]?.email?.trim().toLowerCase();
      if (em === emailEnv) return true;
    }

    return false;
  }

  private getUserClientOrderPrefix(userId: string): string {
    return `inwest-${createHash('sha256').update(userId).digest('hex').slice(0, 12)}-`;
  }

  private createClientOrderId(userId: string): string {
    return `${this.getUserClientOrderPrefix(userId)}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }

  private async requireAlpacaKeys(userId: string): Promise<void> {
    if (!(await hasUserIntegrationKeys(userId, 'alpaca'))) {
      const err = new Error(
        'Alpaca API keys not configured. Add your keys under Account → API keys.'
      ) as Error & { status: number; code: string; service: string };
      err.status = 400;
      err.code = 'INTEGRATION_KEYS_MISSING';
      err.service = 'alpaca';
      throw err;
    }
  }

  private async alpacaForUser(userId: string): Promise<AlpacaApiService> {
    await this.requireAlpacaKeys(userId);
    const client = await getAlpacaClientForUser(userId);
    if (!client) {
      const err = new Error(
        'Alpaca API keys not configured. Add your keys under Account → API keys.'
      ) as Error & { status: number; code: string; service: string };
      err.status = 400;
      err.code = 'INTEGRATION_KEYS_MISSING';
      err.service = 'alpaca';
      throw err;
    }
    return client;
  }

  private getDefaultRiskSettings(): RiskSettings {
    return {
      maxPositionSizePercent: 20,
      dailyLossLimit: 2000,
      perTradeRiskPercent: 2,
    };
  }

  private async getDefaultAccountId(userId: string): Promise<number> {
    const accountExternalId = this.getUserAccountExternalId(userId);
    const account = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.userId, userId),
          eq(tradingAccounts.accountId, accountExternalId)
        )
      )
      .limit(1);

    const existingAccount = account[0];
    if (existingAccount) {
      return existingAccount.id;
    }

    if (!(await hasUserIntegrationKeys(userId, 'alpaca'))) {
      const err = new Error(
        'Alpaca API keys not configured. Add your keys under Account → API keys.'
      ) as Error & { status: number; code: string; service: string };
      err.status = 400;
      err.code = 'INTEGRATION_KEYS_MISSING';
      err.service = 'alpaca';
      throw err;
    }

    try {
      await db.insert(tradingAccounts).values({
        userId,
        accountId: accountExternalId,
        name: 'Alpaca Paper Trading',
        provider: 'alpaca',
        accountType: 'paper',
        status: 'active',
        balance: '0',
        buyingPower: '0',
        portfolioValue: '0',
      });
    } catch (insertError: unknown) {
      const code = (insertError as { code?: string })?.code;
      if (code !== '23505') throw insertError;
    }

    const newAccount = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.userId, userId),
          eq(tradingAccounts.accountId, accountExternalId)
        )
      )
      .limit(1);

    const createdAccount = newAccount[0];
    if (createdAccount) {
      return createdAccount.id;
    }

    throw new Error('Failed to resolve user trading account ID');
  }

  // Initialize trading account if not exists (requires Alpaca keys in DB)
  async initializeAccount(userId: string): Promise<void> {
    await this.requireAlpacaKeys(userId);
    await this.getDefaultAccountId(userId);

    try {
      await this.syncAccountData(userId);
      await this.syncOrders(userId);
      await this.syncExecutions(userId);
    } catch (error) {
      console.warn('Broker sync skipped during account initialize:', error);
    }
  }

  // Sync account data with Alpaca API
  async syncAccountData(userId: string): Promise<void> {
    try {
      if (!(await this.isAlpacaBrokerSyncUser(userId))) {
        return;
      }
      const accountId = await this.getDefaultAccountId(userId);
      const alpaca = await this.alpacaForUser(userId);
      const alpacaAccount = await alpaca.getAccount();

      await db
        .update(tradingAccounts)
        .set({
          balance: alpacaAccount.cash,
          buyingPower: alpacaAccount.buying_power,
          portfolioValue: alpacaAccount.portfolio_value,
          dayTradeCount: alpacaAccount.daytrade_count || 0,
          patternDayTrader: alpacaAccount.pattern_day_trader || false,
          tradingBlocked: alpacaAccount.trading_blocked || false,
          transfersBlocked: alpacaAccount.transfers_blocked || false,
          accountBlocked: alpacaAccount.account_blocked || false,
          lastSynced: new Date(),
        })
        .where(
          and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId))
        );
    } catch (error) {
      console.error('Error syncing account data:', error);
      throw error;
    }
  }

  // Synchronize orders from Alpaca into the requesting user's trading account (see isAlpacaBrokerSyncUser).
  async syncOrders(userId: string, limit = 500): Promise<{ fetched: number; upserted: number }> {
    if (!(await this.isAlpacaBrokerSyncUser(userId))) {
      return { fetched: 0, upserted: 0 };
    }

    const accountId = await this.getDefaultAccountId(userId);
    const alpaca = await this.alpacaForUser(userId);

    const alpacaOrders = await alpaca.getOrders({
      status: 'all',
      limit,
    });

    const list = Array.isArray(alpacaOrders) ? alpacaOrders : [];
    if (list.length === 0) {
      console.log('Alpaca returned 0 orders for sync');
      return { fetched: 0, upserted: 0 };
    }

    console.log(`Syncing ${list.length} orders from Alpaca into local DB (account ${accountId})...`);

    let upserted = 0;
    for (const order of list) {
      const qtyRaw = order.qty ?? (order as { notional?: string }).notional;
      const qtyStr = qtyRaw !== undefined && qtyRaw !== null ? String(qtyRaw) : '0';
      const sym = (order.symbol || '?').toString().slice(0, 10);

      await db.insert(orders).values({
        orderId: order.id,
        accountId,
        symbol: sym,
        side: order.side as 'buy' | 'sell',
        orderType: order.type,
        timeInForce: order.time_in_force,
        quantity: qtyStr,
        filledQuantity: order.filled_qty ? String(order.filled_qty) : '0',
        limitPrice: order.limit_price || null,
        stopPrice: order.stop_price || null,
        averageFillPrice: order.filled_avg_price || null,
        status: order.status,
        submittedAt: new Date(order.submitted_at),
        filledAt: order.filled_at ? new Date(order.filled_at) : null,
        canceledAt: order.canceled_at ? new Date(order.canceled_at) : null,
        expiredAt: order.expired_at ? new Date(order.expired_at) : null,
        updatedAt: new Date(order.updated_at),
        extendedHours: order.extended_hours || false,
        clientOrderId: order.client_order_id || null,
        lastSynced: new Date(),
      })
        .onConflictDoUpdate({
          target: orders.orderId,
          set: {
            accountId,
            status: order.status,
            filledQuantity: order.filled_qty ? String(order.filled_qty) : '0',
            averageFillPrice: order.filled_avg_price || null,
            filledAt: order.filled_at ? new Date(order.filled_at) : null,
            canceledAt: order.canceled_at ? new Date(order.canceled_at) : null,
            expiredAt: order.expired_at ? new Date(order.expired_at) : null,
            updatedAt: new Date(order.updated_at),
            lastSynced: new Date(),
          },
        });
      upserted++;
    }

    console.log(`Order sync complete: ${upserted} orders processed from Alpaca`);
    return { fetched: list.length, upserted };
  }

  // Synchronize executions (fills) from Alpaca
  async syncExecutions(userId: string, pageSize = 100): Promise<void> {
    try {
      if (!(await this.isAlpacaBrokerSyncUser(userId))) {
        return;
      }
      const accountId = await this.getDefaultAccountId(userId);
      let pageToken: string | undefined;
      let synced = 0;
      const seenPageTokens = new Set<string>();

      const alpaca = await this.alpacaForUser(userId);

      for (let page = 0; page < 50; page++) {
        const activities = await alpaca.getAccountActivities({
          activity_type: 'FILL',
          direction: 'desc',
          page_size: pageSize,
          ...(pageToken ? { page_token: pageToken } : {}),
        });

        if (!activities || activities.length === 0) break;

        for (const activity of activities) {
          if (!activity.order_id) continue;

          const orderRecord = await db
            .select({ id: orders.id })
            .from(orders)
            .where(and(
              eq(orders.orderId, activity.order_id),
              eq(orders.accountId, accountId)
            ))
            .limit(1);

          const internalOrderId = orderRecord[0]?.id;
          if (!internalOrderId) continue;

          await db.insert(tradeExecutions).values({
            executionId: activity.id,
            orderId: internalOrderId,
            symbol: activity.symbol || '',
            side: (activity.side as 'buy' | 'sell') || 'buy',
            quantity: activity.qty || '0',
            price: activity.price || '0',
            timestamp: new Date(activity.transaction_time || ''),
            commission: '0',
            fees: '0',
          }).onConflictDoNothing();
          synced++;
        }

        const nextPageToken = activities[activities.length - 1]?.id;
        if (!nextPageToken || activities.length < pageSize || seenPageTokens.has(nextPageToken)) break;
        seenPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
      }

      if (synced > 0) {
        console.log(`Execution synchronization complete (${synced} fill activities checked)`);
      }
    } catch (error) {
      console.error('Error syncing executions:', error);
    }
  }

  // Place a trade order
  async placeOrder(userId: string, orderData: TradeOrder): Promise<any> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      const violations = await this.validateOrderRisk(userId, accountId, orderData);
      if (violations.length > 0) {
        throw new RiskViolationError(violations);
      }

      const clientOrderId = orderData.client_order_id ?? this.createClientOrderId(userId);

      // Convert TradeOrder to CreateOrderRequest
      const alpacaOrderRequest: CreateOrderRequest = {
        symbol: orderData.symbol,
        qty: orderData.qty,
        side: orderData.side,
        type: orderData.type,
        time_in_force: orderData.time_in_force,
        limit_price: orderData.limit_price,
        stop_price: orderData.stop_price,
        extended_hours: orderData.extended_hours,
        client_order_id: clientOrderId,
      };

      // Place order with Alpaca
      const alpaca = await this.alpacaForUser(userId);
      const alpacaOrder = await alpaca.createOrder(alpacaOrderRequest);

      // Record order in database
      const dbOrder = await db.insert(orders).values({
        orderId: alpacaOrder.id,
        accountId: accountId,
        symbol: alpacaOrder.symbol,
        side: alpacaOrder.side as 'buy' | 'sell',
        orderType: alpacaOrder.type,
        timeInForce: alpacaOrder.time_in_force,
        quantity: alpacaOrder.qty || orderData.qty || '0',
        filledQuantity: alpacaOrder.filled_qty || '0',
        limitPrice: alpacaOrder.limit_price || null,
        stopPrice: alpacaOrder.stop_price || null,
        status: alpacaOrder.status,
        submittedAt: new Date(alpacaOrder.submitted_at),
        filledAt: alpacaOrder.filled_at ? new Date(alpacaOrder.filled_at) : null,
        extendedHours: alpacaOrder.extended_hours || false,
        clientOrderId: alpacaOrder.client_order_id || clientOrderId,
      }).returning();

      if (!dbOrder[0]) {
        throw new Error('Failed to record order in database');
      }

      // If order is filled, record execution
      if (alpacaOrder.status === 'filled' && alpacaOrder.filled_qty) {
        await this.recordTradeExecution(dbOrder[0].id, {
          execution_id: `${alpacaOrder.id}_fill`,
          symbol: alpacaOrder.symbol,
          side: alpacaOrder.side as 'buy' | 'sell',
          quantity: alpacaOrder.filled_qty,
          price: alpacaOrder.filled_avg_price || alpacaOrder.limit_price || '0',
          timestamp: new Date(alpacaOrder.filled_at || alpacaOrder.submitted_at),
        });
      }

      // Update positions after successful order
      await this.syncExecutions(userId);
      await this.syncPositions(userId);

      // Update trading session
      await this.updateTradingSession(userId);

      return {
        ...alpacaOrder,
        dbOrderId: dbOrder[0].id,
        accountType: 'paper', // Mark as paper trading
        isPaperTrading: true,
      };
    } catch (error) {
      console.error('Error placing order:', error);
      throw error;
    }
  }

  // Cancel an order
  async cancelOrder(userId: string, orderId: string): Promise<void> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      const existingOrder = await db
        .select({ orderId: orders.orderId })
        .from(orders)
        .where(and(
          eq(orders.orderId, orderId),
          eq(orders.accountId, accountId)
        ))
        .limit(1);

      if (existingOrder.length === 0) {
        throw new Error('Order not found for user account');
      }

      const alpaca = await this.alpacaForUser(userId);
      await alpaca.cancelOrder(orderId);

      // Update order status in database
      await db
        .update(orders)
        .set({
          status: 'canceled',
          canceledAt: new Date(),
          lastSynced: new Date(),
        })
        .where(and(
          eq(orders.orderId, orderId),
          eq(orders.accountId, accountId)
        ));
    } catch (error) {
      console.error('Error canceling order:', error);
      throw error;
    }
  }

  // Get trade history with filters and pagination
  async getTradeHistory(userId: string, filter: TradeHistoryFilter = {}): Promise<{ trades: any[]; pagination: { total: number; page: number; limit: number; pages: number } }> {
    try {
      const page = filter.page || 1;
      const limit = filter.limit || 50;
      const offset = (page - 1) * limit;

      const accountId = await this.getDefaultAccountId(userId);

      // Base conditions
      const conditions = [eq(orders.accountId, accountId)];

      if (filter.startDate) {
        conditions.push(gte(orders.submittedAt, filter.startDate));
      }
      if (filter.endDate) {
        conditions.push(lte(orders.submittedAt, filter.endDate));
      }
      if (filter.symbol) {
        conditions.push(eq(orders.symbol, filter.symbol));
      }
      if (filter.side) {
        conditions.push(eq(orders.side, filter.side));
      }
      if (filter.status) {
        conditions.push(eq(orders.status, filter.status));
      }

      const whereClause = and(...conditions);

      // Get total count for pagination
      const totalCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(whereClause);
      
      const total = Number(totalCountResult[0]?.count || 0);

      // Get paginated data
      const trades = await db
        .select({
          id: orders.id,
          orderId: orders.orderId,
          symbol: orders.symbol,
          side: orders.side,
          orderType: orders.orderType,
          quantity: orders.quantity,
          filledQuantity: orders.filledQuantity,
          limitPrice: orders.limitPrice,
          averageFillPrice: orders.averageFillPrice,
          status: orders.status,
          submittedAt: orders.submittedAt,
          filledAt: orders.filledAt,
          commission: orders.commission,
          fees: orders.fees,
          account: {
            accountType: tradingAccounts.accountType,
            provider: tradingAccounts.provider,
          }
        })
        .from(orders)
        .leftJoin(tradingAccounts, eq(orders.accountId, tradingAccounts.id))
        .where(whereClause)
        .orderBy(desc(orders.submittedAt))
        .limit(limit)
        .offset(offset);

      return {
        trades,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching trade history:', error);
      throw error;
    }
  }

  // Get trading statistics
  async getTradingStats(userId: string, period?: { startDate: Date; endDate: Date }): Promise<TradingStats> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      const conditions = [
        eq(orders.accountId, accountId),
        eq(orders.status, 'filled')
      ];

      if (period) {
        conditions.push(
          gte(orders.submittedAt, period.startDate),
          lte(orders.submittedAt, period.endDate)
        );
      }

      const trades = await db
        .select({
          side: orders.side,
          quantity: orders.quantity,
          averageFillPrice: orders.averageFillPrice,
          commission: orders.commission,
          fees: orders.fees,
        })
        .from(orders)
        .where(and(...conditions));

      const snapshot = await this.calculatePnLSnapshot(accountId);
      // Calculate P&L and statistics
      const stats: TradingStats = {
        totalTrades: trades.length,
        successfulTrades: 0,
        totalPL: snapshot.realizedPL + snapshot.unrealizedPL,
        winRate: 0,
        averageWin: 0,
        averageLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        dayTradeCount: 0,
        realizedPL: snapshot.realizedPL,
        unrealizedPL: snapshot.unrealizedPL,
      };

      const wins: number[] = [];
      const losses: number[] = [];

      for (const tradeResult of snapshot.closedTrades) {
        if (tradeResult > 0) wins.push(tradeResult);
        if (tradeResult < 0) losses.push(tradeResult);
      }

      stats.successfulTrades = wins.length;
      stats.winRate = snapshot.closedTrades.length > 0 ? (wins.length / snapshot.closedTrades.length) * 100 : 0;
      stats.averageWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
      stats.averageLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
      stats.largestWin = wins.length > 0 ? Math.max(...wins) : 0;
      stats.largestLoss = losses.length > 0 ? Math.min(...losses) : 0;
      stats.dayTradeCount = await this.getTodayDayTradeCount(accountId);

      return stats;
    } catch (error) {
      console.error('Error calculating trading stats:', error);
      throw error;
    }
  }

  // Get current positions
  async getPositions(userId: string): Promise<any[]> {
    try {
      await this.syncOrders(userId);
      await this.syncExecutions(userId);
      await this.syncPositions(userId);
      const accountId = await this.getDefaultAccountId(userId);

      return await db
        .select({
          id: positions.id,
          symbol: positions.symbol,
          quantity: positions.quantity,
          side: positions.side,
          marketValue: positions.marketValue,
          costBasis: positions.costBasis,
          unrealizedPL: positions.unrealizedPL,
          unrealizedPLPercent: positions.unrealizedPLPercent,
          currentPrice: positions.currentPrice,
          avgEntryPrice: positions.avgEntryPrice,
          account: {
            accountType: tradingAccounts.accountType,
            provider: tradingAccounts.provider,
          }
        })
        .from(positions)
        .leftJoin(tradingAccounts, eq(positions.accountId, tradingAccounts.id))
        .where(eq(positions.accountId, accountId));
    } catch (error) {
      console.error('Error fetching positions:', error);
      throw error;
    }
  }

  // Close position (sell all shares)
  async closePosition(userId: string, symbol: string): Promise<any> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      // Get current position
      const position = await db
        .select()
        .from(positions)
        .where(and(
          eq(positions.accountId, accountId),
          eq(positions.symbol, symbol)
        ))
        .limit(1);

      if (position.length === 0) {
        throw new Error(`No position found for symbol ${symbol}`);
      }

      const pos = position[0];
      if (!pos) throw new Error('Position data not found');
      const qty = pos.quantity;

      // Place sell order to close position
      return await this.placeOrder(userId, {
        symbol,
        side: 'sell',
        type: 'market',
        time_in_force: 'day',
        qty: qty.toString(),
      });
    } catch (error) {
      console.error('Error closing position:', error);
      throw error;
    }
  }

  // Record trade execution
  private async recordTradeExecution(orderId: number, execution: any): Promise<void> {
    try {
      await db.insert(tradeExecutions).values({
        executionId: execution.execution_id,
        orderId: orderId,
        symbol: execution.symbol,
        side: execution.side,
        quantity: execution.quantity,
        price: execution.price,
        timestamp: execution.timestamp,
        commission: execution.commission || '0',
        fees: execution.fees || '0',
      });
    } catch (error) {
      console.error('Error recording trade execution:', error);
    }
  }

  // Rebuild local positions from the current user's executions.
  private async syncPositions(userId: string): Promise<void> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      const executions = await db
        .select({
          symbol: tradeExecutions.symbol,
          side: tradeExecutions.side,
          quantity: tradeExecutions.quantity,
          price: tradeExecutions.price,
          timestamp: tradeExecutions.timestamp,
        })
        .from(tradeExecutions)
        .leftJoin(orders, eq(tradeExecutions.orderId, orders.id))
        .where(eq(orders.accountId, accountId))
        .orderBy(tradeExecutions.timestamp);

      await db.delete(positions).where(eq(positions.accountId, accountId));

      type Lot = { qty: number; price: number };
      const lotsBySymbol = new Map<string, Lot[]>();

      for (const execution of executions) {
        const symbol = execution.symbol;
        const qty = parseFloat(execution.quantity || '0');
        const price = parseFloat(execution.price || '0');
        if (!symbol || qty <= 0) continue;

        const lots = lotsBySymbol.get(symbol) ?? [];
        if (execution.side === 'buy') {
          lots.push({ qty, price });
          lotsBySymbol.set(symbol, lots);
          continue;
        }

        let remaining = qty;
        while (remaining > 0 && lots.length > 0) {
          const lot = lots[0]!;
          const matched = Math.min(remaining, lot.qty);
          lot.qty -= matched;
          remaining -= matched;
          if (lot.qty <= 0) lots.shift();
        }
        lotsBySymbol.set(symbol, lots);
      }

      const rows = [];
      const symbols = [...lotsBySymbol.keys()].filter(symbol =>
        (lotsBySymbol.get(symbol) ?? []).some(lot => lot.qty > 0)
      );
      const alpaca = await this.alpacaForUser(userId);
      const latestBars = symbols.length > 0 ? await alpaca.getLatestBars(symbols) : {};

      for (const symbol of symbols) {
        const lots = lotsBySymbol.get(symbol) ?? [];
        const quantity = lots.reduce((sum, lot) => sum + lot.qty, 0);
        if (quantity <= 0) continue;

        const costBasis = lots.reduce((sum, lot) => sum + lot.qty * lot.price, 0);
        const avgEntryPrice = costBasis / quantity;
        const currentPrice = latestBars[symbol]?.c
          ? parseFloat(String(latestBars[symbol]?.c))
          : avgEntryPrice;
        const marketValue = quantity * currentPrice;
        const unrealizedPL = marketValue - costBasis;
        const unrealizedPLPercent = costBasis > 0 ? unrealizedPL / costBasis : 0;

        rows.push({
          accountId,
          symbol,
          quantity: quantity.toString(),
          side: 'long' as const,
          marketValue: marketValue.toFixed(2),
          costBasis: costBasis.toFixed(2),
          unrealizedPL: unrealizedPL.toFixed(2),
          unrealizedPLPercent: unrealizedPLPercent.toFixed(4),
          unrealizedIntradayPL: '0',
          unrealizedIntradayPLPercent: '0',
          currentPrice: currentPrice.toString(),
          lastDayPrice: currentPrice.toString(),
          changeToday: '0',
          avgEntryPrice: avgEntryPrice.toString(),
          qty: quantity.toString(),
          marketValueSnapshot: marketValue.toFixed(2),
        });
      }

      if (rows.length > 0) {
        await db.insert(positions).values(rows);
      }
    } catch (error) {
      console.error('Error syncing positions:', error);
    }
  }

  // Update trading session for today
  private async updateTradingSession(userId: string): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const accountId = await this.getDefaultAccountId(userId);
      const account = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, accountId))
        .limit(1);

      if (account.length === 0) return;

      const accountData = account[0];
      if (!accountData) return;

      // Check if session exists for today
      const existingSession = await db
        .select()
        .from(tradingSessions)
        .where(and(
          eq(tradingSessions.accountId, accountData.id),
          eq(tradingSessions.date, today)
        ))
        .limit(1);

      const snapshot = await this.calculatePnLSnapshot(accountData.id);
      const closedTrades = snapshot.closedTrades;
      const wins = closedTrades.filter(v => v > 0);
      const losses = closedTrades.filter(v => v < 0);

      const sessionData = {
        accountId: accountData.id,
        date: today,
        startingBalance: accountData.balance || '0',
        endingBalance: accountData.balance || '0',
        dayTradingBuyingPower: accountData.buyingPower || '0',
        realizedPL: snapshot.realizedPL.toFixed(2),
        unrealizedPL: snapshot.unrealizedPL.toFixed(2),
        totalPL: (snapshot.realizedPL + snapshot.unrealizedPL).toFixed(2),
        tradesCount: closedTrades.length,
        successfulTrades: wins.length,
        dayTradeCount: accountData.dayTradeCount || 0,
        largestWin: (wins.length > 0 ? Math.max(...wins) : 0).toFixed(2),
        largestLoss: (losses.length > 0 ? Math.min(...losses) : 0).toFixed(2),
        updatedAt: new Date(),
      };

      if (existingSession.length === 0) {
        await db.insert(tradingSessions).values(sessionData);
      } else {
        const session = existingSession[0];
        if (session) {
          await db
            .update(tradingSessions)
            .set(sessionData)
            .where(eq(tradingSessions.id, session.id));
        }
      }
    } catch (error) {
      console.error('Error updating trading session:', error);
    }
  }

  async refreshAllUserTradingSessions(): Promise<number> {
    const accounts = await db
      .select({ userId: tradingAccounts.userId })
      .from(tradingAccounts)
      .where(sql`${tradingAccounts.userId} IS NOT NULL`);

    const userIds = [...new Set(accounts.map(account => account.userId).filter((userId): userId is string => Boolean(userId)))];
    for (const userId of userIds) {
      await this.syncOrders(userId);
      await this.syncExecutions(userId);
      await this.syncPositions(userId);
      await this.updateTradingSession(userId);
    }

    return userIds.length;
  }

  // Check if current environment is paper trading
  isPaperTrading(): boolean {
    return true; // Always true for now since we're using paper trading
  }

  // Get trade executions with filters
  async getTradeExecutions(userId: string, filter: TradeHistoryFilter = {}): Promise<any[]> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      let query: any = db
        .select({
          id: tradeExecutions.id,
          executionId: tradeExecutions.executionId,
          symbol: tradeExecutions.symbol,
          side: tradeExecutions.side,
          quantity: tradeExecutions.quantity,
          price: tradeExecutions.price,
          timestamp: tradeExecutions.timestamp,
          commission: tradeExecutions.commission,
          fees: tradeExecutions.fees,
          orderId: tradeExecutions.orderId,
        })
        .from(tradeExecutions)
        .leftJoin(orders, eq(tradeExecutions.orderId, orders.id))
        .where(eq(orders.accountId, accountId));

      // Apply filters
      const conditions = [eq(orders.accountId, accountId)];

      if (filter.startDate) {
        conditions.push(gte(tradeExecutions.timestamp, filter.startDate));
      }
      if (filter.endDate) {
        conditions.push(lte(tradeExecutions.timestamp, filter.endDate));
      }
      if (filter.symbol) {
        conditions.push(eq(tradeExecutions.symbol, filter.symbol));
      }
      if (filter.side) {
        conditions.push(eq(tradeExecutions.side, filter.side));
      }

      if (conditions.length > 1) {
        query = query.where(and(...conditions));
      }

      query = query
        .orderBy(desc(tradeExecutions.timestamp))
        .limit(filter.limit || 100)
        .offset(filter.offset || 0);

      return await query;
    } catch (error) {
      console.error('Error fetching trade executions:', error);
      throw error;
    }
  }

  // Get trading sessions with filters
  async getTradingSessions(userId: string, filter: TradeHistoryFilter = {}): Promise<any[]> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      let query: any = db
        .select({
          id: tradingSessions.id,
          date: tradingSessions.date,
          startingBalance: tradingSessions.startingBalance,
          endingBalance: tradingSessions.endingBalance,
          dayTradingBuyingPower: tradingSessions.dayTradingBuyingPower,
          realizedPL: tradingSessions.realizedPL,
          unrealizedPL: tradingSessions.unrealizedPL,
          totalPL: tradingSessions.totalPL,
          tradesCount: tradingSessions.tradesCount,
          successfulTrades: tradingSessions.successfulTrades,
          dayTradeCount: tradingSessions.dayTradeCount,
          largestWin: tradingSessions.largestWin,
          largestLoss: tradingSessions.largestLoss,
        })
        .from(tradingSessions)
        .where(eq(tradingSessions.accountId, accountId));

      // Apply filters
      const conditions = [eq(tradingSessions.accountId, accountId)];

      if (filter.startDate) {
        conditions.push(gte(tradingSessions.date, filter.startDate));
      }
      if (filter.endDate) {
        conditions.push(lte(tradingSessions.date, filter.endDate));
      }

      if (conditions.length > 1) {
        query = query.where(and(...conditions));
      }

      query = query
        .orderBy(desc(tradingSessions.date))
        .limit(filter.limit || 30)
        .offset(filter.offset || 0);

      return await query;
    } catch (error) {
      console.error('Error fetching trading sessions:', error);
      throw error;
    }
  }

  // Get orders with filters (enhanced version of getTradeHistory)
  async getOrders(userId: string, filter: TradeHistoryFilter = {}): Promise<any[]> {
    try {
      const accountId = await this.getDefaultAccountId(userId);
      let query: any = db
        .select({
          id: orders.id,
          orderId: orders.orderId,
          symbol: orders.symbol,
          side: orders.side,
          orderType: orders.orderType,
          timeInForce: orders.timeInForce,
          quantity: orders.quantity,
          filledQuantity: orders.filledQuantity,
          limitPrice: orders.limitPrice,
          stopPrice: orders.stopPrice,
          averageFillPrice: orders.averageFillPrice,
          status: orders.status,
          submittedAt: orders.submittedAt,
          filledAt: orders.filledAt,
          canceledAt: orders.canceledAt,
          commission: orders.commission,
          fees: orders.fees,
          extendedHours: orders.extendedHours,
          clientOrderId: orders.clientOrderId,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.accountId, accountId));

      // Apply filters
      const conditions = [eq(orders.accountId, accountId)];

      if (filter.startDate) {
        conditions.push(gte(orders.submittedAt, filter.startDate));
      }
      if (filter.endDate) {
        conditions.push(lte(orders.submittedAt, filter.endDate));
      }
      if (filter.symbol) {
        conditions.push(eq(orders.symbol, filter.symbol));
      }
      if (filter.side) {
        conditions.push(eq(orders.side, filter.side));
      }
      if (filter.status) {
        conditions.push(eq(orders.status, filter.status));
      }

      if (conditions.length > 1) {
        query = query.where(and(...conditions));
      }

      query = query
        .orderBy(desc(orders.submittedAt))
        .limit(filter.limit || 100)
        .offset(filter.offset || 0);

      return await query;
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  }

  // Get account type info
  async getAccountInfo(userId: string): Promise<any> {
    try {
      await this.requireAlpacaKeys(userId);
      const accountId = await this.getDefaultAccountId(userId);
      const account = await db
        .select()
        .from(tradingAccounts)
        .where(and(
          eq(tradingAccounts.id, accountId),
          eq(tradingAccounts.userId, userId)
        ))
        .limit(1);

      if (account.length === 0) {
        await this.initializeAccount(userId);
        return await this.getAccountInfo(userId);
      }

      const accountData = account[0];
      if (!accountData) throw new Error('Account data not found');

      const balance = String(accountData.balance ?? '0');
      const buyingPower = String(accountData.buyingPower ?? '0');
      const portfolioValue = String(accountData.portfolioValue ?? '0');

      return {
        ...accountData,
        balance,
        buyingPower,
        portfolioValue,
        portfolio_value: portfolioValue,
        buying_power: buyingPower,
        cash: balance,
        equity: portfolioValue,
        pattern_day_trader: accountData.patternDayTrader,
        daytrade_count: accountData.dayTradeCount,
        dayTradeCount: accountData.dayTradeCount,
        isPaperTrading: accountData.accountType === 'paper',
        environment: accountData.accountType,
        status: accountData.status,
        patternDayTrader: accountData.patternDayTrader,
      };
    } catch (error) {
      console.error('Error fetching account info:', error);
      throw error;
    }
  }

  async getRiskSettings(userId: string): Promise<RiskSettings> {
    const accountId = await this.getDefaultAccountId(userId);
    const record = await db
      .select()
      .from(tradingRiskSettings)
      .where(eq(tradingRiskSettings.accountId, accountId))
      .limit(1);

    const settings = record[0];
    if (!settings) {
      const defaults = this.getDefaultRiskSettings();
      await db.insert(tradingRiskSettings).values({
        accountId,
        maxPositionSizePercent: defaults.maxPositionSizePercent.toString(),
        dailyLossLimit: defaults.dailyLossLimit.toString(),
        perTradeRiskPercent: defaults.perTradeRiskPercent.toString(),
      }).onConflictDoNothing();
      return defaults;
    }

    return {
      maxPositionSizePercent: parseFloat(settings.maxPositionSizePercent || '20'),
      dailyLossLimit: parseFloat(settings.dailyLossLimit || '2000'),
      perTradeRiskPercent: parseFloat(settings.perTradeRiskPercent || '2'),
    };
  }

  async updateRiskSettings(userId: string, next: Partial<RiskSettings>): Promise<RiskSettings> {
    const accountId = await this.getDefaultAccountId(userId);
    const current = await this.getRiskSettings(userId);
    const merged: RiskSettings = {
      maxPositionSizePercent: next.maxPositionSizePercent ?? current.maxPositionSizePercent,
      dailyLossLimit: next.dailyLossLimit ?? current.dailyLossLimit,
      perTradeRiskPercent: next.perTradeRiskPercent ?? current.perTradeRiskPercent,
    };
    await db.insert(tradingRiskSettings).values({
      accountId,
      maxPositionSizePercent: merged.maxPositionSizePercent.toString(),
      dailyLossLimit: merged.dailyLossLimit.toString(),
      perTradeRiskPercent: merged.perTradeRiskPercent.toString(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: tradingRiskSettings.accountId,
      set: {
        maxPositionSizePercent: merged.maxPositionSizePercent.toString(),
        dailyLossLimit: merged.dailyLossLimit.toString(),
        perTradeRiskPercent: merged.perTradeRiskPercent.toString(),
        updatedAt: new Date(),
      }
    });
    return merged;
  }

  isRiskViolationError(error: unknown): error is RiskViolationError {
    return error instanceof RiskViolationError;
  }

  private async getTodayDayTradeCount(accountId: number): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const filledToday = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.accountId, accountId), eq(orders.status, 'filled'), gte(orders.filledAt, start), lte(orders.filledAt, end)));
    return Number(filledToday[0]?.count || 0);
  }

  private async validateOrderRisk(userId: string, accountId: number, orderData: TradeOrder): Promise<RiskViolation[]> {
    const violations: RiskViolation[] = [];
    const settings = await this.getRiskSettings(userId);
    const account = await this.getAccountInfo(userId);
    const portfolioValue = parseFloat(account.portfolioValue || '0');
    const buyingPower = parseFloat(account.buyingPower || '0');
    const qty = parseFloat(orderData.qty || '0');
    const estimatedPrice = await this.getEstimatedOrderPrice(userId, orderData);
    const orderNotional = qty * estimatedPrice;

    const maxAllowedPosition = portfolioValue * (settings.maxPositionSizePercent / 100);
    if (orderData.side === 'buy' && maxAllowedPosition > 0 && orderNotional > maxAllowedPosition) {
      violations.push({
        code: 'MAX_POSITION_SIZE',
        message: `Order value $${orderNotional.toFixed(2)} exceeds max position size $${maxAllowedPosition.toFixed(2)} (${settings.maxPositionSizePercent}% of portfolio).`,
      });
    }

    if (orderData.side === 'buy' && orderNotional > buyingPower) {
      violations.push({
        code: 'MAX_POSITION_SIZE',
        message: `Order value $${orderNotional.toFixed(2)} exceeds available buying power $${buyingPower.toFixed(2)}.`,
      });
    }

    const todayLoss = await this.getTodayLoss(accountId);
    if (todayLoss >= settings.dailyLossLimit) {
      violations.push({
        code: 'DAILY_LOSS_LIMIT',
        message: `Daily loss limit reached (${todayLoss.toFixed(2)} >= ${settings.dailyLossLimit.toFixed(2)}).`,
      });
    }

    const maxRisk = portfolioValue * (settings.perTradeRiskPercent / 100);
    if (orderData.side === 'buy' && maxRisk > 0 && !orderData.stop_price) {
      violations.push({
        code: 'PER_TRADE_RISK',
        message: `Stop price is required to validate per-trade risk (${settings.perTradeRiskPercent}% of portfolio).`,
      });
      return violations;
    }

    const stopPrice = orderData.stop_price ? parseFloat(orderData.stop_price) : estimatedPrice;
    const perUnitRisk =
      orderData.side === 'buy' ? Math.max(estimatedPrice - stopPrice, 0) : Math.max(stopPrice - estimatedPrice, 0);
    const totalRisk = perUnitRisk * qty;
    if (maxRisk > 0 && totalRisk > maxRisk) {
      violations.push({
        code: 'PER_TRADE_RISK',
        message: `Estimated trade risk $${totalRisk.toFixed(2)} exceeds per-trade risk budget $${maxRisk.toFixed(2)} (${settings.perTradeRiskPercent}% of portfolio).`,
      });
    }

    return violations;
  }

  private async getEstimatedOrderPrice(userId: string, orderData: TradeOrder): Promise<number> {
    if (orderData.limit_price) return parseFloat(orderData.limit_price);
    if (orderData.stop_price && orderData.type === 'stop') return parseFloat(orderData.stop_price);
    try {
      const alpaca = await this.alpacaForUser(userId);
      const latestBars = await alpaca.getLatestBars([orderData.symbol.toUpperCase()]);
      const bar = latestBars[orderData.symbol.toUpperCase()];
      if (bar?.c) return parseFloat(String(bar.c));
    } catch (error) {
      console.warn('Failed to fetch latest bar for risk estimation:', error);
    }
    return 0;
  }

  private async getTodayLoss(accountId: number): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const snapshot = await this.calculatePnLSnapshot(accountId, start);
    return Math.max(0, -snapshot.realizedPL);
  }

  private async calculatePnLSnapshot(accountId: number, since?: Date): Promise<{ realizedPL: number; unrealizedPL: number; closedTrades: number[] }> {
    const executionConditions = [eq(orders.accountId, accountId)];
    if (since) {
      executionConditions.push(gte(tradeExecutions.timestamp, since));
    }

    const executions = await db
      .select({
        symbol: tradeExecutions.symbol,
        side: tradeExecutions.side,
        quantity: tradeExecutions.quantity,
        price: tradeExecutions.price,
        commission: tradeExecutions.commission,
        fees: tradeExecutions.fees,
        timestamp: tradeExecutions.timestamp,
      })
      .from(tradeExecutions)
      .leftJoin(orders, eq(tradeExecutions.orderId, orders.id))
      .where(and(...executionConditions))
      .orderBy(tradeExecutions.timestamp);

    type Lot = { qty: number; price: number };
    const lots = new Map<string, Lot[]>();
    let realizedPL = 0;
    const closedTrades: number[] = [];

    for (const exec of executions) {
      const symbol = exec.symbol;
      const qty = parseFloat(exec.quantity || '0');
      const price = parseFloat(exec.price || '0');
      const fees = parseFloat(exec.commission || '0') + parseFloat(exec.fees || '0');
      const queue = lots.get(symbol) ?? [];

      if (exec.side === 'buy') {
        queue.push({ qty, price });
        lots.set(symbol, queue);
        continue;
      }

      let remaining = qty;
      let tradeRealized = -fees;
      while (remaining > 0 && queue.length > 0) {
        const lot = queue[0]!;
        const matched = Math.min(remaining, lot.qty);
        tradeRealized += (price - lot.price) * matched;
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 0) queue.shift();
      }
      realizedPL += tradeRealized;
      closedTrades.push(tradeRealized);
      lots.set(symbol, queue);
    }

    const currentPositions = await db
      .select({
        unrealizedPL: positions.unrealizedPL,
      })
      .from(positions)
      .where(eq(positions.accountId, accountId));

    const unrealizedPL = currentPositions.reduce((sum, p) => sum + parseFloat(p.unrealizedPL || '0'), 0);
    return { realizedPL, unrealizedPL, closedTrades };
  }
}

export const tradingService = new TradingService();