import { Component, Input } from '@angular/core';
import { TitleCasePipe,DecimalPipe, DatePipe } from '@angular/common'; // ✅ add this
import{Transaction} from '../../models/transaction.model';
import { TransactionService } from '../../services/transaction';


@Component({
  selector: 'app-transaction-list',
  standalone : true,
  imports: [TitleCasePipe,DecimalPipe,DatePipe],
  templateUrl: './transaction-list.html',
  styleUrl: './transaction-list.css',
})
export class TransactionList {
@Input()transactions : Transaction[] = [];
  @Input() dateFormat: 'yyyy-MM-dd' | 'dd/MM/yyyy' = 'yyyy-MM-dd';
constructor(private transactionService: TransactionService){}

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
}
