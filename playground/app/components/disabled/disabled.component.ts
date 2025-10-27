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
  public months = [];
  public month = (new Date()).getMonth();

}
