import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollPickerComponent } from '../../../../src/app/components/scroll-picker/scroll-picker.component';
import { ScrollPickerTemplateComponent } from '../../../../src/app/directives/scroll-picker-template.directive';
import { JsonPipe } from '@angular/common';


@Component({
    selector: 'app-disabled',
    templateUrl: 'disabled.component.html',
    styleUrls: ['disabled.component.scss'],
    standalone: true,
    imports: [FormsModule, ScrollPickerComponent, ScrollPickerTemplateComponent, JsonPipe]
})
export class DisabledComponent {

  public config = {};
  public model = new Date('2015-10-10 15:45');
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
  public month = (new Date()).getMonth();

}
