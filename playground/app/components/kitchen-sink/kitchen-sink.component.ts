import { Component } from '@angular/core';
import { KitchenSinkConfigureComponent } from '../kitchen-sink-configure';
import { FsExampleComponent } from '@firestitch/example';
import { FsMessage } from '@firestitch/message';
import { enUS } from 'date-fns/locale'
import { range } from 'lodash-es';


@Component({
  selector: 'kitchen-sink',
  templateUrl: 'kitchen-sink.component.html',
  styleUrls: ['kitchen-sink.component.scss']
})
export class KitchenSinkComponent {

  public config = {};
  public model = new Date('2015-10-10 15:45');
  public months = [];
  public years = [];
  public days = [];
  public day = 5;
  public year = 2000;
  public month;

  constructor(
    private exampleComponent: FsExampleComponent,
    private message: FsMessage
  ) {
    exampleComponent.setConfigureComponent(KitchenSinkConfigureComponent, { config: this.config });

    for (let i = 0; i < 12; i++) {
      this.months.push({ name: enUS.localize.month(i), value: i + 1 });
    }

    this.month = Object.assign({}, this.months[2]);

    this.days = range(1, 31)
    .map((day) => {
      return { name: day, value: day };
    });

    this.years = range(1900, 2020)
    .map((year) => {
      return { name: year, value: year };
    });
  }
}
