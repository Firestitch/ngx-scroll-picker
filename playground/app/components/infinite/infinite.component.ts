import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollPickerComponent } from '../../../../src/app/components/scroll-picker/scroll-picker.component';
import { ScrollPickerTemplateComponent } from '../../../../src/app/directives/scroll-picker-template.directive';


@Component({
    selector: 'app-infinite',
    templateUrl: 'infinite.component.html',
    styleUrls: ['infinite.component.scss'],
    standalone: true,
    imports: [FormsModule, ScrollPickerComponent, ScrollPickerTemplateComponent],
})
export class InfiniteComponent {

  public months = [
    { name: 'January', value: 0 },
    { name: 'February', value: 1 },
    { name: 'March', value: 2 },
    { name: 'April', value: 3 },
    { name: 'May', value: 4 },
    { name: 'June', value: 5 },
    { name: 'July', value: 6 },
    { name: 'August', value: 7 },
    { name: 'September', value: 8 },
    { name: 'October', value: 9 },
    { name: 'November', value: 10 },
    { name: 'December', value: 11 },
  ];

  public hours = Array.from({ length: 12 }, (_, i) => ({ name: i + 1, value: i + 1 }));
  public minutes = Array.from({ length: 60 }, (_, i) => ({
    name: String(i).padStart(2, '0'),
    value: i,
  }));

  public month = (new Date()).getMonth();
  public hour = 10;
  public minute = 45;

}
