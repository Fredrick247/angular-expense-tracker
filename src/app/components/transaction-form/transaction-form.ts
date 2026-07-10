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
  form : FormGroup;

  incomeCategories: string[] = ['Salary', 'Bonus', 'Freelance', 'Investment', 'Transfer'];
  expenseCategories: string[] = ['Food', 'Rent', 'Transport', 'Bills', 'Shopping', 'Transfer'];

  constructor(
    private fb: FormBuilder,
    private transactionService : TransactionService
  ){
    this.form = this.fb.group({
      type: ['expense' as TransactionType, Validators.required],
      category : ['', Validators.required],
      description: [''],

      //New ingredients for amount
      baseAmount : [null,[Validators.required, Validators.min(0.01)]],
      taxPercent: [null],
      otherCharges: [null],
      discountPercent: [null],

      amount:[null,[Validators.required]],
      date : [this.todayString(),Validators.required]
    });

    // If you switch type and current category doesn't belong to that type,
    // clear the category so user must pick a valid one.
    this.form.get('type')?.valueChanges.subscribe((type: TransactionType)=> {
    const list = type === 'income' ? this.incomeCategories : this.expenseCategories;
    const current = this.form.get('category')?.value as string;
    if(!list.includes(current)){
      this.form.patchValue({category: ''})
    }
  });

  // New calc amount whenever the pieces change
  this.setupAmountCalculation();
  }
  

  private todayString(): string{
    return new Date().toISOString().substring(0,10);
  }

  // 🔹 Categories to show in the dropdown based on current type
  get categories(): string[] {
    const type = this.form.get('type')?.value as TransactionType;
    return type === 'income' ? this.incomeCategories : this.expenseCategories;
  }
   // 🔹 Add a custom category tied to the current type
  addCategory(): void {
    const type = this.form.get('type')?.value as TransactionType;
    const input = prompt('Enter new category name');
    if (!input) return;

    const name = input.trim();
    if (!name) return;

    const targetList =
      type === 'income' ? this.incomeCategories : this.expenseCategories;

    if (!targetList.includes(name)) {
      targetList.push(name);
    }

    // set the form's category to the new one
    this.form.patchValue({ category: name });
  }

  private setupAmountCalculation(): void{
    this.form.valueChanges.subscribe(val =>{
      const base = +val.baseAmount || 0;
      const taxPerc = +val.taxPercent || 0;
      const others = +val.otherCharges || 0;
      const discPerc = +val.discountPercent || 0;
      const type = val.type as TransactionType;

      const taxAmount = base * (taxPerc / 100);
      const discountAmount = base * (discPerc / 100);
      let total : number;

      if(type === 'income'){
        total = base - others - taxAmount - discountAmount;
      }else{
        total = base + others + taxAmount - discountAmount;
      }

      //avoid infinite loop
      this.form.get('amount')?.setValue(total,{emitEvent:false});
    });
  }

  onSubmit(){
    if(this.form.invalid)return;

    const raw = this.form.value;

    this.transactionService.addTransaction({
      type : raw.type,
      category : raw.category,
      description : raw.description,
      amount : raw.amount,
      date: raw.date
    });


    // this.transactionService.addTransaction(this.form.value);
    // this.form.patchValue({
    //   description:'',
    //   amount: null
    // })

    // reset only the fields that normally change
   this.form.patchValue({
  description: '',
  baseAmount: null,
  taxPercent: null,
  otherCharges: null,
  discountPercent: null,
  amount: null,
  date: this.todayString()
  });
  }
  
}
