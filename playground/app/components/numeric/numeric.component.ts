import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ScrollPickerNumericComponent } from '../../../../src/app/components/scroll-picker-numeric/scroll-picker-numeric.component';


@Component({
  selector: 'app-numeric',
  templateUrl: 'numeric.component.html',
  styleUrls: ['numeric.component.scss'],
  standalone: true,
  imports: [FormsModule, ScrollPickerNumericComponent],
})
export class NumericComponent {

  public quantity = 7;

  public price = 24.99;

  public weight = 165.5;
  public weightUnit = 'lbs';
  public weightUnits = ['lbs', 'kgs'];

  public reading = 3.142;

  public temperature = 21;
  public temperatureUnits = [
    { name: '°C', value: 'celsius' },
    { name: '°F', value: 'fahrenheit' },
  ];
  public temperatureUnit = 'celsius';

}
