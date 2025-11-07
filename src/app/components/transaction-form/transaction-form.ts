import { Component } from '@angular/core';
import { ReactiveFormsModule,FormBuilder,FormGroup,Validators } from '@angular/forms';
import { TransactionType } from '../../models/transaction.model';
import { TransactionService } from '../../services/transaction';


@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.css',
})

export class TransactionForm {
  form : FormGroup

  constructor(
    private fb: FormBuilder,
    private transactionService : TransactionService
  ){
    this.form = this.fb.group({
      type: ['expense' as TransactionType, Validators.required],
      category : ['', Validators.required],
      description: [''],
      amount:[null,[Validators.required, Validators.min(0.01)]],
      date : [this.todayString(),Validators.required]
    });
  }

  private todayString(): string{
    return new Date().toISOString().substring(0,10);
  }

  onSubmit(){
    if(this.form.invalid)return;

    this.transactionService.addTransaction(this.form.value);
    this.form.patchValue({
      description:'',
      amount: null
    })
  }

}
