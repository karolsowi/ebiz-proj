import { portfolioService, importService } from '../services/databaseService';

export interface CSVPortfolioEntry {
  symbol: string;
  name?: string | undefined;
  quantity: number;
  averageCost: number;
  currentPrice?: number | undefined;
  sector?: string | undefined;
  industry?: string | undefined;
  assetType?: string | undefined;
  notes?: string | undefined;
}

export interface ImportResult {
  success: boolean;
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  errors: string[];
  importId?: number;
}

export class CSVImporter {
  private static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  private static validatePortfolioEntry(entry: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!entry.symbol || typeof entry.symbol !== 'string') {
      errors.push('Symbol is required and must be a string');
    }
    
    if (!entry.quantity || isNaN(parseFloat(entry.quantity))) {
      errors.push('Quantity is required and must be a number');
    }
    
    if (!entry.averageCost || isNaN(parseFloat(entry.averageCost))) {
      errors.push('Average cost is required and must be a number');
    }
    
    if (entry.currentPrice && isNaN(parseFloat(entry.currentPrice))) {
      errors.push('Current price must be a number if provided');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  private static normalizePortfolioEntry(rawEntry: Record<string, string>): CSVPortfolioEntry {
    return {
      symbol: rawEntry.symbol?.toUpperCase() || '',
      name: rawEntry.name || rawEntry.companyName || undefined,
      quantity: parseFloat(rawEntry.quantity || rawEntry.shares || '0'),
      averageCost: parseFloat(rawEntry.averageCost || rawEntry.avgCost || rawEntry.costBasis || '0'),
      currentPrice: rawEntry.currentPrice ? parseFloat(rawEntry.currentPrice) : undefined,
      sector: rawEntry.sector || undefined,
      industry: rawEntry.industry || undefined,
      assetType: rawEntry.assetType || rawEntry.type || 'stock',
      notes: rawEntry.notes || rawEntry.description || undefined,
    };
  }

  static async importPortfolioCSV(
    csvContent: string,
    filename: string,
    options: {
      hasHeader?: boolean;
      delimiter?: string;
      skipEmptyLines?: boolean;
      updateExisting?: boolean;
      userId: string;
    }
  ): Promise<ImportResult> {
    const {
      hasHeader = true,
      delimiter = ',',
      skipEmptyLines = true,
      updateExisting = true,
      userId
    } = options;

    if (!userId) {
      throw new Error('userId is required for portfolio CSV imports');
    }

    // Record import attempt
    const importRecord = await importService.recordImport({
      filename,
      fileSize: csvContent.length,
      importType: 'portfolio',
      status: 'processing',
      metadata: { hasHeader, delimiter, skipEmptyLines, updateExisting, userId }
    });

    if (!importRecord || importRecord.length === 0) {
      throw new Error('Failed to create import record');
    }

    const importId = importRecord[0]!.id;
    const errors: string[] = [];
    let recordsProcessed = 0;
    let recordsSuccessful = 0;
    let recordsFailed = 0;

    try {
      const lines = csvContent.split('\n').filter(line => 
        skipEmptyLines ? line.trim().length > 0 : true
      );

      if (lines.length === 0) {
        throw new Error('CSV file is empty');
      }

      let headers: string[] = [];
      let dataStartIndex = 0;

      if (hasHeader) {
        const headerLine = lines[0];
        if (headerLine) {
          headers = this.parseCSVLine(headerLine).map(h => h.toLowerCase().replace(/\s+/g, ''));
          dataStartIndex = 1;
        } else {
          throw new Error('Header line is missing');
        }
      } else {
        // Default headers for portfolio CSV
        headers = ['symbol', 'name', 'quantity', 'averagecost', 'currentprice', 'sector', 'industry', 'assettype', 'notes'];
      }

      // Process data rows
      for (let i = dataStartIndex; i < lines.length; i++) {
        recordsProcessed++;
        
        try {
          const line = lines[i];
          if (!line) continue;
          
          const values = this.parseCSVLine(line);
          
          if (values.length === 0 || (values.length === 1 && values[0] === '')) {
            continue; // Skip empty lines
          }

          // Create entry object from CSV row
          const rawEntry: Record<string, string> = {};
          headers.forEach((header, index) => {
            rawEntry[header] = values[index] || '';
          });

          // Normalize and validate entry
          const entry = this.normalizePortfolioEntry(rawEntry);
          const validation = this.validatePortfolioEntry(entry);

          if (!validation.valid) {
            recordsFailed++;
            errors.push(`Row ${i + 1}: ${validation.errors.join(', ')}`);
            continue;
          }

          // Convert to database format
          const dbEntry: {
            symbol: string;
            name?: string;
            quantity: string;
            averageCost: string;
            currentPrice?: string;
            sector?: string;
            industry?: string;
            assetType?: string;
            source?: string;
            notes?: string;
          } = {
            symbol: entry.symbol,
            quantity: entry.quantity.toString(),
            averageCost: entry.averageCost.toString(),
            assetType: entry.assetType || 'stock',
            source: 'csv_import',
          };
          if (entry.name !== undefined) dbEntry.name = entry.name;
          if (entry.currentPrice !== undefined) dbEntry.currentPrice = entry.currentPrice.toString();
          if (entry.sector !== undefined) dbEntry.sector = entry.sector;
          if (entry.industry !== undefined) dbEntry.industry = entry.industry;
          if (entry.notes !== undefined) dbEntry.notes = entry.notes;

          // Save to database
          if (updateExisting) {
            await portfolioService.addOrUpdateEntry(dbEntry, userId);
          } else {
            // Check if exists first
            const existing = await portfolioService.getEntryBySymbol(entry.symbol, userId);
            if (existing.length > 0) {
              recordsFailed++;
              errors.push(`Row ${i + 1}: Symbol ${entry.symbol} already exists (use update mode to overwrite)`);
              continue;
            }
            await portfolioService.addOrUpdateEntry(dbEntry, userId);
          }

          recordsSuccessful++;
        } catch (error) {
          recordsFailed++;
          errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Update import status
      await importService.updateImportStatus(
        importId,
        recordsFailed === 0 ? 'completed' : 'completed_with_errors',
        recordsProcessed,
        recordsSuccessful,
        recordsFailed,
        errors
      );

      return {
        success: recordsFailed === 0,
        recordsProcessed,
        recordsSuccessful,
        recordsFailed,
        errors,
        importId
      };

    } catch (error) {
      // Update import status as failed
      await importService.updateImportStatus(
        importId,
        'failed',
        recordsProcessed,
        recordsSuccessful,
        recordsFailed,
        [error instanceof Error ? error.message : 'Unknown error']
      );

      return {
        success: false,
        recordsProcessed,
        recordsSuccessful,
        recordsFailed,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        importId
      };
    }
  }

  // Generate sample CSV template
  static generateSampleCSV(): string {
    const headers = [
      'Symbol',
      'Name',
      'Quantity',
      'Average Cost',
      'Current Price',
      'Sector',
      'Industry',
      'Asset Type',
      'Notes'
    ];

    const sampleData = [
      ['AAPL', 'Apple Inc.', '100', '150.00', '175.50', 'Technology', 'Consumer Electronics', 'stock', 'Long-term hold'],
      ['GOOGL', 'Alphabet Inc.', '50', '2500.00', '2750.00', 'Technology', 'Internet Services', 'stock', 'Growth stock'],
      ['MSFT', 'Microsoft Corporation', '75', '300.00', '350.00', 'Technology', 'Software', 'stock', 'Dividend stock'],
      ['TSLA', 'Tesla Inc.', '25', '800.00', '900.00', 'Consumer Cyclical', 'Auto Manufacturers', 'stock', 'Volatile but promising'],
      ['BTC-USD', 'Bitcoin', '0.5', '45000.00', '50000.00', 'Cryptocurrency', 'Digital Currency', 'crypto', 'Digital gold']
    ];

    const csvLines = [headers.join(',')];
    sampleData.forEach(row => {
      csvLines.push(row.map(cell => `"${cell}"`).join(','));
    });

    return csvLines.join('\n');
  }

  // Validate CSV format before import
  static validateCSVFormat(csvContent: string, hasHeader = true): { valid: boolean; errors: string[]; preview: any[] } {
    const errors: string[] = [];
    const preview: any[] = [];

    try {
      const lines = csvContent.split('\n').filter(line => line.trim().length > 0);
      
      if (lines.length === 0) {
        errors.push('CSV file is empty');
        return { valid: false, errors, preview };
      }

      let headers: string[] = [];
      let dataStartIndex = 0;

      if (hasHeader) {
        const headerLine = lines[0];
        if (headerLine) {
          headers = this.parseCSVLine(headerLine);
          dataStartIndex = 1;
          
          // Check for required columns
          const requiredColumns = ['symbol', 'quantity', 'averagecost'];
          const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/\s+/g, ''));
          
          const missingColumns = requiredColumns.filter(col => 
            !normalizedHeaders.some(header => header.includes(col))
          );
          
          if (missingColumns.length > 0) {
            errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
          }
        } else {
          errors.push('Header line is missing');
        }
      }

      // Preview first few rows
      for (let i = dataStartIndex; i < Math.min(dataStartIndex + 5, lines.length); i++) {
        const line = lines[i];
        if (!line) continue;
        
        const values = this.parseCSVLine(line);
        if (hasHeader && headers.length > 0) {
          const rowObj: Record<string, string> = {};
          headers.forEach((header, index) => {
            rowObj[header] = values[index] || '';
          });
          preview.push(rowObj);
        } else {
          preview.push(values);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        preview
      };

    } catch (error) {
      errors.push(`CSV parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { valid: false, errors, preview };
    }
  }
}

// Export utility functions
export const csvImporter = CSVImporter; 