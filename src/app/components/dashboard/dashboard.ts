import { Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Transaction } from '../../models/transaction.model';
import { TransactionService } from '../../services/transaction';
import { TransactionForm } from '../transaction-form/transaction-form';
import { TransactionList } from '../transaction-list/transaction-list';
import { BankStatementUpload } from '../bank-statement-upload/bank-statement-upload';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TransactionForm, TransactionList, BankStatementUpload, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent {
  transactions: Transaction[] = [];

  totalIncome = 0;
  totalExpense = 0;
  balance = 0;
  dateFormat: 'yyyy-MM-dd' | 'dd/MM/yyyy' = 'yyyy-MM-dd';
  sortDirection : 'asc' | 'desc' = 'desc';

  constructor(private transactionService: TransactionService) {}

  ngOnInit() {
      this.transactionService.transactions$.subscribe(transactions => {
      this.transactions = this.sortTransactions(transactions);
      this.calculateSummary();
    });
  }

  private calculateSummary() {
    this.totalIncome = this.transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    this.totalExpense = this.transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    this.balance = this.totalIncome - this.totalExpense;
  }

  onClearAll() {
    if (confirm('Clear all transactions?')) {
      this.transactionService.clearAll();
    }
  }

  setDateFormat(fmt :'yyyy-MM-dd' | 'dd/MM/yyyy'){
    this.dateFormat = fmt;
  }

  toggleDateFormat(){
    this.dateFormat =
    this.dateFormat === 'yyyy-MM-dd' ? 'dd/MM/yyyy' : 'yyyy-MM-dd';
  }

  toggleSortDirection(){
    this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
    this.transactions = this.sortTransactions(this.transactions);
  }

  private sortTransactions(list: Transaction[]): Transaction[]{
    return[...list].sort((a,b)=>{
      if(this.sortDirection === 'desc'){
        return b.date.localeCompare(a.date);
      }
      return a.date.localeCompare(b.date);
    });
  }
}
