import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TransactionService } from '../../services/transaction';
import { Transaction, TransactionType } from '../../models/transaction.model';

declare module 'pdfjs-dist/legacy/build/pdf.mjs';

@Component({
  selector: 'app-bank-statement-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bank-statement-upload.html',
  styleUrl: './bank-statement-upload.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankStatementUpload {
  status = signal('');
  importedCount = signal(0);
  warnings = signal('');

  constructor(private transactionService: TransactionService) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      this.status.set('No file selected.');
      return;
    }

    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        this.importCsv(text);
      };
      reader.onerror = () => {
        this.status.set('Unable to read file.');
      };
      reader.readAsText(file, 'UTF-8');
      return;
    }

    if (name.endsWith('.pdf')) {
      this.importPdf(file);
      return;
    }

    this.status.set('Please upload a CSV or PDF bank statement file.');
  }

  private importCsv(content: string): void {
    const { headers, rows } = this.parseCsv(content);
    if (!headers.length || !rows.length) {
      this.status.set('CSV file appears empty or has invalid content.');
      this.warnings.set('');
      this.importedCount.set(0);
      return;
    }

    const result = this.mapRowsToTransactions(headers, rows);
    if (!result.entries.length) {
      this.status.set('No valid transactions were found in the statement.');
      this.warnings.set(result.warnings || '');
      this.importedCount.set(0);
      return;
    }

    this.transactionService.importTransactions(result.entries);
    this.importedCount.set(result.entries.length);
    this.status.set(`${result.entries.length} transactions imported successfully.`);
    this.warnings.set(result.warnings || '');
  }

  private async importPdf(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = async () => {
      const buffer = reader.result as ArrayBuffer;
      if (!buffer) {
        this.status.set('Unable to read PDF file.');
        return;
      }

      try {
        const text = await this.extractTextFromPdf(buffer);
        if (!text || text.trim().length === 0) {
          this.status.set('PDF appears to be image-based or contains no extractable text. Please use a text-based PDF statement.');
          this.warnings.set('Scanned PDFs cannot be processed. Ask your bank for a digital/text-based statement.');
          return;
        }

        // Check if the extracted text seems reasonable for a bank statement
        const textLength = text.trim().length;
        const wordCount = text.split(/\s+/).length;

        if (textLength < 200 || wordCount < 20) {
          this.status.set('PDF contains very little text content. It may be image-based or corrupted.');
          this.warnings.set('Please ensure the PDF is a text-based bank statement, not a scanned image.');
          return;
        }

        this.importPdfText(text);
      } catch (error: any) {
        console.error('PDF parsing error:', error);
        const errorMessage = error.message || 'Unknown error';

        if (errorMessage.includes('InvalidPDFException') || errorMessage.includes('corrupt') || errorMessage.includes('invalid')) {
          this.status.set('PDF file appears to be corrupted or invalid. Please try a different file.');
        } else if (errorMessage.includes('password') || errorMessage.includes('encrypted')) {
          this.status.set('PDF is password-protected. Please remove password protection and try again.');
        } else if (errorMessage.includes('timeout')) {
          this.status.set('PDF is too large or complex to process. Please try a smaller file.');
        } else if (errorMessage.includes('No text content')) {
          this.status.set('PDF appears to be image-based (scanned). Please use a text-based PDF statement.');
        } else {
          this.status.set(`Unable to parse PDF: ${errorMessage}`);
        }
      }
    };
    reader.onerror = () => {
      this.status.set('Unable to read PDF file.');
    };
    reader.readAsArrayBuffer(file);
  }

  private async extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
    try {
      const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;

      // Set up worker with proper error handling
      try {
        const workerUrl = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch (workerError) {
        console.warn('Worker setup failed, trying CDN fallback:', workerError);
        // Fallback: try to use the worker from CDN
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';
      }

      const loadingTask = pdfjsLib.getDocument({
        data: buffer,
        verbosity: 0,
        disableFontFace: true, // Disable font loading for better performance
        disableRange: true, // Disable range requests
      });

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('PDF loading timeout - file may be too large or corrupted')), 30000);
      });

      const pdf = await Promise.race([loadingTask.promise, timeoutPromise]);

      if (!pdf || typeof pdf.numPages !== 'number' || pdf.numPages === 0) {
        throw new Error('PDF contains no pages or is invalid');
      }

      const pageCount = Math.min(pdf.numPages, 50); // Limit to first 50 pages to prevent excessive processing
      const pageTexts: string[] = [];

      for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
        try {
          const page = await pdf.getPage(pageNum);
          const content = await page.getTextContent();

          if (!content || !content.items || !Array.isArray(content.items)) {
            console.warn(`Page ${pageNum} has no text content`);
            continue;
          }

              const pageText = this.buildPageTextFromItems(content.items);

          if (pageText) {
            pageTexts.push(pageText);
          } else {
            console.warn(`Page ${pageNum} extracted no usable text`);
          }
        } catch (pageError) {
          console.warn(`Failed to extract text from page ${pageNum}:`, pageError);
          // Continue with other pages
        }
      }

      const fullText = pageTexts.join('\n').trim();

      if (!fullText) {
        throw new Error('No text content could be extracted from the PDF. It may be image-based or corrupted.');
      }

      console.log(`Extracted ${fullText.length} characters from ${pageTexts.length} pages`);
      return fullText;
    } catch (error) {
      console.error('PDF extraction error details:', error);
      // Re-throw with more context
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`PDF extraction failed: ${String(error)}`);
    }
  }

  private buildPageTextFromItems(items: any[]): string {
    const rowsByY = new Map<number, Array<{ x: number; str: string }>>();

    for (const item of items) {
      if (!item || typeof item.str !== 'string') {
        continue;
      }

      const transform = Array.isArray(item.transform) ? item.transform : item.item?.transform;
      const x = transform?.[4] ?? 0;
      const y = transform?.[5] ?? 0;
      if (typeof y !== 'number' || typeof x !== 'number') {
        continue;
      }

      const roundedY = Math.round(y * 10) / 10;
      const row = rowsByY.get(roundedY) ?? [];
      row.push({ x, str: item.str.trim() });
      rowsByY.set(roundedY, row);
    }

    const sortedRows = Array.from(rowsByY.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, cells]) =>
        cells
          .sort((a, b) => a.x - b.x)
          .map(cell => cell.str)
          .join(' ')
          .trim(),
      )
      .filter(line => line.length > 0);

    return sortedRows.join('\n');
  }

  private importPdfText(text: string): void {
    // Preprocess text to clean up common PDF artifacts
    const cleanedText = this.preprocessPdfText(text);

    // Extract transaction lines more intelligently
    const transactionLines = this.extractTransactionLines(cleanedText);

    if (!transactionLines.length) {
      this.status.set('No valid PDF transactions were found in the statement.');
      this.warnings.set('Try a different PDF or ensure it contains transaction data.');
      this.importedCount.set(0);
      return;
    }

    const rows = transactionLines
      .map(line => this.extractPdfRow(line))
      .filter((row): row is string[] => row !== null);

    if (!rows.length) {
      this.status.set('No valid transactions were found in the PDF statement.');
      this.warnings.set('The PDF format may not be supported. Try CSV format instead.');
      this.importedCount.set(0);
      return;
    }

    const headers = ['date', 'description', 'amount', 'type'];
    const result = this.mapRowsToTransactions(headers, rows);
    if (!result.entries.length) {
      this.status.set('No valid transactions were found in the PDF statement.');
      this.warnings.set(result.warnings || 'Check that dates and amounts are properly formatted.');
      this.importedCount.set(0);
      return;
    }

    this.transactionService.importTransactions(result.entries);
    this.importedCount.set(result.entries.length);
    this.status.set(`${result.entries.length} transactions imported successfully.`);
    this.warnings.set(result.warnings || '');
  }

  private preprocessPdfText(text: string): string {
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !this.isNoticeLine(line) && !this.isSummaryLine(line) && !this.isTableHeaderLine(line));

    return lines
      .join('\n')
      // Remove page headers/footers (common patterns)
      .replace(/\bPage \d+ of \d+\b/gi, '')
      .replace(/\bStatement Date[:\s]*[^\n]*/gi, '')
      .replace(/\bAccount Number[:\s]*[^\n]*/gi, '')
      .replace(/\bBalance[:\s]*[^\n]*/gi, '')
      // Remove excessive whitespace within joined text
      .replace(/\s{3,}/g, '  ')
      // Remove line breaks that don't separate transactions
      .replace(/\n(?!\d{1,2}[\/\-]\d{1,2}[\/\-])/g, ' ')
      // Clean up
      .trim();
  }

  private isNoticeLine(line: string): boolean {
    const normalized = line.trim().toLowerCase();
    return /\b(important notice|notis penting|effective\s+\d{1,2}\s+[a-z]+\s+\d{4}|callcentre|call centre|www\.cimb|cimb\.com\.my|cimb bank|cimb bank berhad|statement of account|statement date|statement date\s*\/\s*tarikh|tarikh penyata|page\s*\/\s*halaman|page\s+\d+\s+of\s+\d+|halaman|account number|call centre|phone banking|email at|statement is deemed|enquire balances|for more information|you can transfer funds|you can funds|for more information|important notice|notis penting|ref no|deposits tax|tax \(rm\)|balance \(rm\)|opening balance|closing balance|end of statement|akhir penyata|phone banking service is free|mm\/s|bbb-ppppppp)\b/i.test(normalized)
      || /\b(expense|income)\s+\1\b/i.test(line)
      || (/\b(date|description|ref no|deposits|tax|rm|page)\b/i.test(normalized) && /\b(statement|halaman|cimb|bank|page|date|call centre|callcentre)\b/i.test(normalized));
  }

  private isSummaryLine(line: string): boolean {
    const normalized = line.trim().toLowerCase();
    return /\b(points?|mata)\b/.test(normalized)
      && /\b(bonus|relationship|earned|redeemed|transferred|available|expiring|ringkasan|jumlah|baki|diperolehi|ditunaikan|dipindahkan|akan lupus)\b/.test(normalized);
  }

  private isTableHeaderLine(line: string): boolean {
    const normalized = line.trim().toLowerCase();

    const headerPhrases = [
      'savings account transaction details',
      'butir-butir transaksi akaun simpanan',
      'account no / no akaun',
      'no akaun',
      'basic savings account',
      'transaction details',
      'butir-butir transaksi',
      'statement of account',
      'statement date',
      'page / halaman',
      'points expiring by',
      'amount of points expiring'
    ];

    if (headerPhrases.some(phrase => normalized.includes(phrase))) {
      return true;
    }

    const tokens = [
      'date', 'tarikh', 'description', 'diskripsi',
      'ref no', 'rujukan', 'withdrawal', 'pengeluaran',
      'deposits', 'deposit', 'tax', 'cukai',
      'balance', 'baki', 'statement', 'halaman',
      'savings', 'account', 'transaction', 'details',
      'butir-butir', 'akaun', 'simpanan', 'no', 'akan', 'lupus'
    ];

    const found = tokens.filter(token => normalized.includes(token)).length;
    const rmCount = (normalized.match(/\b(rm|\(rm\))\b/gi) || []).length;

    return found >= 4 || rmCount >= 2;
  }

  private extractTransactionLines(text: string): string[] {
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !this.isNoticeLine(line) && !this.isSummaryLine(line) && !this.isTableHeaderLine(line));

    const datePattern = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/;
    const isoDatePattern = /\b\d{4}-\d{2}-\d{2}\b/;
    const amountPattern = /[-]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?/;

    const transactionLines: string[] = [];
    let currentTransaction = '';

    for (const line of lines) {
      if (this.isNoticeLine(line) || this.isSummaryLine(line) || this.isTableHeaderLine(line)) {
        if (currentTransaction.trim()) {
          transactionLines.push(currentTransaction.trim());
        }
        currentTransaction = '';
        continue;
      }

      const hasDate = datePattern.test(line) || isoDatePattern.test(line);
      const hasAmount = amountPattern.test(line);
      const looksLikeHeader = /\b(date|description|ref no|deposits|tax|balance|page|statement|halaman|cimb|call centre|callcentre)\b/i.test(line)
        && !hasDate;

      if (looksLikeHeader) {
        if (currentTransaction.trim()) {
          transactionLines.push(currentTransaction.trim());
        }
        currentTransaction = '';
        continue;
      }

      if (hasDate && hasAmount) {
        if (currentTransaction.trim()) {
          transactionLines.push(currentTransaction.trim());
        }
        currentTransaction = line;
      } else if (currentTransaction) {
        currentTransaction += ' ' + line;
      }
    }

    if (currentTransaction.trim()) {
      transactionLines.push(currentTransaction.trim());
    }

    return transactionLines;
  }

  private extractPdfRow(line: string): string[] | null {
    // More comprehensive date patterns
    const datePatterns = [
      /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\b/, // DD/MM/YYYY or MM/DD/YYYY
      /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2})\b/,  // DD/MM/YY or MM/DD/YY
      /\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/, // YYYY/MM/DD
    ];

    let dateMatch: RegExpMatchArray | null = null;
    for (const pattern of datePatterns) {
      dateMatch = line.match(pattern);
      if (dateMatch) break;
    }

    if (!dateMatch) {
      return null;
    }

    const dateString = dateMatch[0];

    if (this.isSummaryLine(line)) {
      return null;
    }

    const numericAmountRegex = /[-]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})/g;
    const lineAfterDate = line.slice(line.indexOf(dateString) + dateString.length).trim();
    const candidateAmounts = Array.from(lineAfterDate.matchAll(numericAmountRegex)).map(m => m[0]);

    const validAmounts = candidateAmounts.filter(amount => {
      const cleanAmount = amount.replace(/[^0-9.,\-]/g, '');
      const numValue = parseFloat(cleanAmount.replace(/,/g, '.'));
      return Number.isFinite(numValue) && numValue !== 0;
    });

    if (!validAmounts.length) {
      return null;
    }

    const amountString = this.selectTransactionAmount(validAmounts, lineAfterDate);
    if (!amountString) {
      return null;
    }

    // Extract description by removing all numeric amount tokens
    let description = lineAfterDate
      .replace(numericAmountRegex, '')
      .replace(/\b(debit|withdrawal|payment|dr|credit|deposit|cr|received|transfer|atm|pos|online|fee|interest|charge)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Only strip "by order of" phrases, keep transaction IDs for reference
    description = description.replace(/\b(by\s+order\s+of|order\s+of)\s+/gi, '').trim();
    if (!description || description.length < 3) {
      description = this.inferDescriptionFromLine(line);
    }

    // Enhanced type detection
    const typeHint = this.determineTransactionType(line, amountString);

    return [dateString, description || 'Imported transaction', amountString, typeHint];
  }

  private inferDescriptionFromLine(line: string): string {
    // Look for common transaction keywords
    const keywords = [
      'ATM', 'POS', 'ONLINE', 'TRANSFER', 'PAYMENT', 'DEPOSIT', 'WITHDRAWAL',
      'FEE', 'INTEREST', 'CHARGE', 'SALARY', 'RENT', 'UTILITIES', 'GROCERIES'
    ];

    for (const keyword of keywords) {
      if (line.toUpperCase().includes(keyword)) {
        return keyword;
      }
    }

    // Extract words that look like merchant names (capitalized words)
    const words = line.split(/\s+/).filter(word =>
      word.length > 2 &&
      word === word.toUpperCase() &&
      !/\d/.test(word) // No numbers
    );

    if (words.length > 0) {
      return words.slice(0, 3).join(' '); // Take first 3 capitalized words
    }

    return 'Imported transaction';
  }

  private stripReferenceTokens(description: string): string {
    if (!description) return '';

    const cleaned = description
      // Remove hex-like codes (e26b431327dc429eb749)
      .replace(/\b[a-f0-9]{20,}\b/gi, '')
      // Remove long numeric sequences that look like reference IDs (10+ digits)
      .replace(/\b\d{10,}\b/g, '')
      // Remove account/reference number patterns like 2061212M0003261861O
      .replace(/\b\d+[A-Z]+\d+[A-Z0-9]*\b/g, '')
      // Remove repeated hex patterns
      .replace(/\b[a-f0-9]{16,}\b/gi, '')
      // Remove patterns like "order of NAME" but keep the actual merchant
      .replace(/\b(by\s+order\s+of|by\s+|order\s+of)\s+/gi, '')
      // Remove extra whitespace
      .replace(/\s{2,}/g, ' ')
      .trim();

    return cleaned;
  }


  private determineTransactionType(line: string, amountString: string): string {
    const lineUpper = line.toUpperCase();

    if (/\b(DEBIT|WITHDRAWAL|PAYMENT|DR|OUTGOING|SPENT|CHARGE|FEE)\b/.test(lineUpper)) {
      return 'expense';
    }

    if (/\b(CREDIT|DEPOSIT|RECEIVED|CR|INCOME|SALARY|REFUND|INTEREST)\b/.test(lineUpper)) {
      return 'income';
    }

    if (/\b(TRANSFER TO|TRANSFER FROM|DUITNOW|FUND TRANSFER|TO ACCOUNT|FROM ACCOUNT)\b/.test(lineUpper)) {
      return amountString.includes('-') || amountString.startsWith('(') ? 'expense' : 'income';
    }

    if (amountString.includes('-') || (amountString.startsWith('(') && amountString.endsWith(')'))) {
      return 'expense';
    }

    const expenseKeywords = ['ATM', 'POS', 'FEE', 'CHARGE', 'PAYMENT', 'BILL', 'TAX'];
    if (expenseKeywords.some(keyword => lineUpper.includes(keyword))) {
      return 'expense';
    }

    const incomeKeywords = ['SALARY', 'DEPOSIT', 'INTEREST', 'REFUND'];
    if (incomeKeywords.some(keyword => lineUpper.includes(keyword))) {
      return 'income';
    }

    return 'expense';
  }

  private selectTransactionAmount(amounts: string[], line: string): string {
    if (amounts.length === 1) {
      return amounts[0];
    }

    const parsedAmounts = amounts.map(value => ({
      raw: value,
      value: this.parseAmount(value),
    })).filter(item => Number.isFinite(item.value));

    if (!parsedAmounts.length) {
      return amounts[amounts.length - 1];
    }

    const lineUpper = line.toUpperCase();
    const mentionsBalance = /\b(BALANCE|BAKI|BAL|CLOSING|OPENING)\b/.test(lineUpper);

    if (parsedAmounts.length >= 2) {
      const last = parsedAmounts[parsedAmounts.length - 1];
      const previous = parsedAmounts[parsedAmounts.length - 2];

      if (mentionsBalance) {
        return previous.raw;
      }

      if (parsedAmounts.length === 2 && Math.abs(previous.value) > Math.abs(last.value) * 1.5) {
        return previous.raw;
      }

      if (Math.abs(last.value) > Math.abs(previous.value) * 2 && Math.abs(last.value) > 100) {
        return previous.raw;
      }

      if (parsedAmounts.length >= 3) {
        return previous.raw;
      }
    }

    return parsedAmounts[0].raw;
  }

  private parseCsv(content: string): { headers: string[]; rows: string[][] } {
    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter((line, index) => line.length > 0 || index === 0);

    if (!lines.length) {
      return { headers: [], rows: [] };
    }

    const headers = this.parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(line => this.parseCsvLine(line)).filter(row => row.some(cell => cell.length > 0));
    return { headers, rows };
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        const nextChar = line[i + 1];
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current.trim());
    return values;
  }

  private mapRowsToTransactions(headers: string[], rows: string[][]): { entries: Omit<Transaction, 'id'>[]; warnings: string } {
    const normalizedHeaders = headers.map(header => header.trim().toLowerCase());

    const dateIndex = this.findHeaderIndex(normalizedHeaders, [
      'date',
      'transaction date',
      'posted date',
      'value date',
      'booking date',
    ]);

    const descriptionIndex = this.findHeaderIndex(normalizedHeaders, [
      'description',
      'narration',
      'details',
      'particulars',
      'transaction details',
    ]);

    const amountIndex = this.findHeaderIndex(normalizedHeaders, ['amount', 'amt', 'value', 'transaction amount']);
    const debitIndex = this.findHeaderIndex(normalizedHeaders, ['debit', 'withdrawal', 'debit amount']);
    const creditIndex = this.findHeaderIndex(normalizedHeaders, ['credit', 'deposit', 'credit amount']);
    const typeIndex = this.findHeaderIndex(normalizedHeaders, ['type', 'transaction type']);
    const categoryIndex = this.findHeaderIndex(normalizedHeaders, ['category', 'memo', 'category/description']);

    const warnings: string[] = [];
    const entries: Omit<Transaction, 'id'>[] = [];

    for (const row of rows) {
      const dateValue = this.cellValue(row, dateIndex);
      const rawDescription = this.cellValue(row, descriptionIndex) || '';
      const rawCategory = this.cellValue(row, categoryIndex) || '';
      const typeValue = this.cellValue(row, typeIndex);

      const parsedDate = this.normalizeDate(dateValue);
      if (!parsedDate) {
        warnings.push(`Skipped row because date could not be parsed: ${dateValue}`);
        continue;
      }

      const debitValue = this.cellValue(row, debitIndex);
      const creditValue = this.cellValue(row, creditIndex);
      const amountValue = this.cellValue(row, amountIndex);

      const parsedAmount = this.parseAmount(amountValue);
      const debitAmount = this.parseAmount(debitValue);
      const creditAmount = this.parseAmount(creditValue);

      const type = this.determineType(typeValue, parsedAmount, debitAmount, creditAmount);
      const amount = this.determineAmount(parsedAmount, debitAmount, creditAmount, type);

      if (!Number.isFinite(amount) || amount === 0) {
        warnings.push(`Skipped row because amount could not be parsed: ${amountValue || debitValue || creditValue}`);
        continue;
      }

      // Use provided category, or infer from description and type
      const category = rawCategory || this.inferCategory(rawDescription, type);

      // Clean up description
      const description = this.cleanDescription(rawDescription) || 'Imported transaction';

      entries.push({
        date: parsedDate,
        category,
        description,
        amount,
        type,
      });
    }

    return { entries, warnings: warnings.join(' ') };
  }

  private findHeaderIndex(headers: string[], keys: string[]): number {
    return headers.findIndex(header => keys.some(key => header.includes(key.toLowerCase())));
  }

  private cellValue(row: string[], index: number): string {
    return index >= 0 && index < row.length ? row[index].trim() : '';
  }

  private normalizeDate(value: string): string | null {
    const raw = value.trim();
    if (!raw) {
      return null;
    }

    // Remove any time component
    const datePart = raw.split(' ')[0].split('T')[0];

    // Replace various separators with hyphens
    const normalizedSeparators = datePart.replace(/[\/\.]/g, '-');

    const parts = normalizedSeparators.split('-').filter(p => p.length > 0);

    if (parts.length !== 3) {
      // Try parsing as a full date string
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }

    let year = parts[0];
    let month = parts[1];
    let day = parts[2];

    // Determine date format based on component sizes and values
    const numParts = parts.map(p => parseInt(p, 10));

    if (numParts.some(isNaN)) {
      return null;
    }

    // If first part is 4 digits, it's likely YYYY-MM-DD
    if (year.length === 4) {
      // Already in YYYY-MM-DD format
    }
    // If last part is 4 digits, it's likely DD-MM-YYYY or MM-DD-YYYY
    else if (day.length === 4) {
      year = day;
      // Need to determine if first part is day or month
      if (numParts[0] > 12) {
        // First part > 12, must be day, so MM-DD-YYYY becomes DD-MM-YYYY
        day = parts[0];
        month = parts[1];
      } else if (numParts[1] > 12) {
        // Second part > 12, must be day, so DD-MM-YYYY stays DD-MM-YYYY
        day = parts[1];
        month = parts[0];
      } else {
        // Ambiguous, assume MM-DD-YYYY -> DD-MM-YYYY
        day = parts[1];
        month = parts[0];
      }
    }
    // If middle part is 4 digits, it's likely MM-YYYY-DD (unlikely but handle it)
    else if (month.length === 4) {
      const temp = month;
      month = day;
      day = parts[0];
      year = temp;
    }
    // All parts are 2 digits, need to determine format
    else {
      // Common formats: DD-MM-YY, MM-DD-YY, YY-MM-DD
      if (numParts[0] > 12) {
        // First part > 12, must be day: DD-MM-YY
        day = parts[0];
        month = parts[1];
        year = parts[2];
      } else if (numParts[1] > 12) {
        // Second part > 12, must be day: MM-DD-YY
        month = parts[0];
        day = parts[1];
        year = parts[2];
      } else {
        // Ambiguous, assume DD-MM-YY (more common internationally)
        day = parts[0];
        month = parts[1];
        year = parts[2];
      }
    }

    // Convert 2-digit years
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      year = (yearNum < 50 ? '20' : '19') + year; // 50+ = 1950s, <50 = 2000s
    }

    // Ensure proper formatting
    const formatted = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // Validate the date
    const parsed = new Date(formatted);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    // Additional validation: reasonable date ranges
    const yearNum = parsed.getFullYear();
    const monthNum = parsed.getMonth() + 1;
    const dayNum = parsed.getDate();

    if (yearNum < 2000 || yearNum > 2030) {
      return null; // Unreasonable year
    }

    if (monthNum < 1 || monthNum > 12) {
      return null; // Invalid month
    }

    if (dayNum < 1 || dayNum > 31) {
      return null; // Invalid day
    }

    return formatted;
  }

  private parseAmount(value: string): number {
    if (!value || typeof value !== 'string') {
      return NaN;
    }

    const raw = value.trim();

    // Handle parentheses for negative amounts (common in accounting)
    const isNegative = raw.startsWith('(') && raw.endsWith(')');
    const cleaned = isNegative
      ? raw.slice(1, -1)
      : raw.replace(/^-/, ''); // Remove leading minus if present

    // Remove currency symbols and codes
    const withoutCurrency = cleaned
      .replace(/^[A-Z]{3}\s*/, '') // Remove currency codes at start
      .replace(/\s*[A-Z]{3}$/, '') // Remove currency codes at end
      .replace(/^[£$€¥₹₽₩₦₨₪₫₡₵₺₴₸₼₲₱₭₯₰₳₶₷₹₻₽₾₿]\s*/, '') // Remove currency symbols at start
      .replace(/\s*[£$€¥₹₽₩₦₨₪₫₡₵₺₴₸₼₲₱₭₯₰₳₶₷₹₻₽₾₿]$/, ''); // Remove currency symbols at end

    // Handle different number formats
    let normalized = withoutCurrency
      .replace(/\s+/g, '') // Remove spaces
      .replace(/,/g, '.') // Convert commas to decimal points
      .replace(/(\..*)\./g, '$1'); // Remove duplicate decimal points

    // Handle cases where comma is used as thousands separator
    const parts = normalized.split('.');
    if (parts.length === 2) {
      // If we have a decimal part, check if the last part before decimal has comma groups
      const integerPart = parts[0];
      const decimalPart = parts[1];

      // If integer part has commas and is longer than 3 digits, treat comma as thousands separator
      if (integerPart.includes(',') && integerPart.replace(/,/g, '').length > 3) {
        normalized = integerPart.replace(/,/g, '') + '.' + decimalPart;
      }
    }

    const number = Number(normalized);
    if (!Number.isFinite(number)) {
      return NaN;
    }

    return isNegative ? -Math.abs(number) : number;
  }

  private determineType(typeValue: string, amount: number, debitAmount: number, creditAmount: number): TransactionType {
    const normalizedType = typeValue.trim().toLowerCase();
    if (normalizedType.includes('income') || normalizedType.includes('credit') || normalizedType.includes('deposit')) {
      return 'income';
    }
    if (normalizedType.includes('expense') || normalizedType.includes('debit') || normalizedType.includes('withdrawal')) {
      return 'expense';
    }

    if (creditAmount > 0) {
      return 'income';
    }

    if (debitAmount > 0) {
      return 'expense';
    }

    return amount < 0 ? 'expense' : 'income';
  }

  private determineAmount(parsedAmount: number, debitAmount: number, creditAmount: number, type: TransactionType): number {
    if (creditAmount > 0 && debitAmount === 0) {
      return type === 'income' ? creditAmount : -creditAmount;
    }
    if (debitAmount > 0 && creditAmount === 0) {
      return type === 'expense' ? debitAmount : -debitAmount;
    }
    if (Number.isFinite(parsedAmount)) {
      return Math.abs(parsedAmount);
    }
    return NaN;
  }

  private inferCategory(description: string, transactionType: TransactionType): string {
    const descUpper = description.toUpperCase().trim();
    if (!descUpper) {
      return transactionType === 'income' ? 'Income' : 'Expense';
    }

    if (/\b(DUITNOW|FUND TRANSFER|TRANSFER TO|TRANSFER FROM|TO ACCOUNT|FROM ACCOUNT|TRF TO|TRF FROM|REMIT|ONLINE TRANSFER)\b/.test(descUpper)) {
      return 'Transfer';
    }

    if (transactionType === 'income') {
      if (descUpper.includes('SALARY') || descUpper.includes('PAYROLL')) return 'Salary';
      if (descUpper.includes('BONUS') || descUpper.includes('COMMISSION')) return 'Bonus';
      if (descUpper.includes('INTEREST') || descUpper.includes('DIVIDEND')) return 'Investment';
      if (descUpper.includes('REFUND') || descUpper.includes('REIMBURSEMENT')) return 'Refund';
      if (descUpper.includes('DEPOSIT') || descUpper.includes('RECEIVED')) return 'Transfer';
      return 'Income';
    }

    if (descUpper.includes('GROCERY') || descUpper.includes('SUPERMARKET') || descUpper.includes('MART')) return 'Food';
    if (descUpper.includes('RESTAURANT') || descUpper.includes('CAFE') || descUpper.includes('FOOD')) return 'Food';
    if (descUpper.includes('GAS') || descUpper.includes('PETROL') || descUpper.includes('FUEL')) return 'Transport';
    if (descUpper.includes('TAXI') || descUpper.includes('UBER') || descUpper.includes('LYFT')) return 'Transport';
    if (descUpper.includes('BUS') || descUpper.includes('TRAIN') || descUpper.includes('METRO')) return 'Transport';
    if (descUpper.includes('PARKING') || descUpper.includes('TOLL')) return 'Transport';
    if (descUpper.includes('RENT') || descUpper.includes('LEASE')) return 'Rent';
    if (descUpper.includes('ELECTRICITY') || descUpper.includes('WATER') || descUpper.includes('GAS BILL')) return 'Bills';
    if (descUpper.includes('INTERNET') || descUpper.includes('PHONE') || descUpper.includes('MOBILE')) return 'Bills';
    if (descUpper.includes('INSURANCE') || descUpper.includes('PREMIUM')) return 'Bills';
    if (descUpper.includes('ATM') || descUpper.includes('WITHDRAWAL')) return 'Cash Withdrawal';
    if (descUpper.includes('ONLINE') || descUpper.includes('SHOPPING') || descUpper.includes('AMAZON')) return 'Shopping';
    if (descUpper.includes('PHARMACY') || descUpper.includes('MEDICAL') || descUpper.includes('HOSPITAL')) return 'Medical';
    if (descUpper.includes('ENTERTAINMENT') || descUpper.includes('MOVIE') || descUpper.includes('CINEMA')) return 'Entertainment';
    if (descUpper.includes('FEE') || descUpper.includes('CHARGE') || descUpper.includes('SERVICE')) return 'Fees';
    if (descUpper.includes('TRANSFER') || descUpper.includes('PAYMENT')) return 'Transfer';

    const commonMerchants = ['STARBUCKS', 'MCDONALDS', 'WALMART', 'TARGET', 'COSTCO', 'IKEA', 'SHELL', 'BP', 'EXXON', 'CHEVRON'];
    const merchantCategoryMap: Record<string, string> = {
      STARBUCKS: 'Shopping',
      MCDONALDS: 'Shopping',
      WALMART: 'Shopping',
      TARGET: 'Shopping',
      COSTCO: 'Shopping',
      IKEA: 'Shopping',
      SHELL: 'Transport',
      BP: 'Transport',
      EXXON: 'Transport',
      CHEVRON: 'Transport',
    };

    for (const merchant of commonMerchants) {
      if (descUpper.includes(merchant)) {
        return merchantCategoryMap[merchant];
      }
    }

    return 'Expense';
  }

  private cleanDescription(description: string): string {
    if (!description) return '';

    return description
      .replace(/\b(debit|withdrawal|payment|dr|credit|deposit|cr|received|transfer|atm|pos|online|fee|interest|charge|card|account)\b/gi, '')
      .replace(/\b(rm|\(rm\))\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[()\s]+|[()\s]+$/g, '')
      .trim();
  }
}
