// This file defines the shape of a transaction and its type
export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: number;
  type: TransactionType;
  category: string;
  description?: string;
  amount: number;
  date: string; // store as 'yyyy-mm-dd'
}
