import { Component, Input, Output,EventEmitter } from '@angular/core';
import { TitleCasePipe,DecimalPipe, DatePipe } from '@angular/common'; // ✅ add this
import{Transaction} from '../../models/transaction.model';
import { TransactionService } from '../../services/transaction';
import { CommonModule } from '@angular/common';   // <-- ADD THIS
import { FormsModule } from '@angular/forms';   // <-- ADD THIS for ngModel


@Component({
  selector: 'app-transaction-list',
  standalone : true,
  imports: [TitleCasePipe,DecimalPipe,DatePipe,CommonModule,FormsModule],
  templateUrl: './transaction-list.html',
  styleUrl: './transaction-list.css',
})
export class TransactionList {
  @Input() transactions: Transaction[] = [];
  @Input() dateFormat: 'yyyy-MM-dd' | 'dd/MM/yyyy' = 'yyyy-MM-dd';
  @Input() sortDirection: 'asc' | 'desc' = 'desc';
  @Output() sortToggle = new EventEmitter<void>();

  currentPage = 1;
  pageSize = 10;
  availablePageSizes = [5, 10, 20, 50, 100];

  constructor(private transactionService: TransactionService) {}

  get totalPages(): number {
    return Math.ceil(this.transactions.length / this.pageSize);
  }

  get paginatedTransactions(): Transaction[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return this.transactions.slice(startIndex, endIndex);
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  changePageSize(newSize: number): void {
    this.pageSize = newSize;
    this.currentPage = 1;
  }

public onSortToggle(): void{
  this.sortToggle.emit();
}

public onEditAmount(t: Transaction): void{
  const input = prompt('Enter new amount (RM)', t.amount.toString());
  if(input === null){
    return;
  }

  const value = Number(input);
  if(isNaN(value) || value <= 0){
    alert('Please enter a valid positive number.');
    return;
  }
  this.transactionService.updateTransaction(t.id,{amount: value});
}
public onDelete(id: number): void {
  this.transactionService.removeTransaction(id);
}

descriptionLines(description?: string): string[] | null {
  if (!description) return null;
  const lines = description.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length ? lines : null;
}
}
