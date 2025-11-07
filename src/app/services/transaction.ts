import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {Transaction,TransactionType} from '../models/transaction.model';
const STORAGE_KEY =   'expense-tracker-transactions';

@Injectable({
  providedIn: 'root',
})
export class TransactionService {
  private transactionsSubject = new BehaviorSubject<Transaction[]>(this.loadFromStorage());
  transactions$ = this.transactionsSubject.asObservable();

  private loadFromStorage(): Transaction[]{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  private saveToStorage(transactions : Transaction[]){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }

  private getCurrent(): Transaction[]{
    return this.transactionsSubject.value;
  }
  
  addTransaction(data: Omit<Transaction, 'id'>){
    const current =this.getCurrent();
    const newTransaction : Transaction  = {
      id : current.length ? Math.max(...current.map(t => t.id)) + 1 : 1,
      ...data
    };

    const updated = [...current, newTransaction];
    this.transactionsSubject.next(updated);
    this.saveToStorage(updated);
  }

  updateTransaction(id:number, changes:Partial<Transaction>): void{
    const current =this.getCurrent();
    const updated = current.map(t =>
      t.id === id ? {...t, ...changes} : t
    );
    this.transactionsSubject.next(updated);
    this.saveToStorage(updated);
  }

  removeTransaction(id : number){
    const updated = this.getCurrent().filter(t => t.id !== id);
    this.transactionsSubject.next(updated);
    this.saveToStorage(updated);
  }

  clearAll(){
    this.transactionsSubject.next([]);
    localStorage.removeItem(STORAGE_KEY);
  }
}
