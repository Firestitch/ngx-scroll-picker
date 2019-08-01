import { Component } from '@angular/core';
import { KitchenSinkConfigureComponent } from '../kitchen-sink-configure';
import { FsExampleComponent } from '@firestitch/example';
import { FsMessage } from '@firestitch/message';
import { localize } from 'date-fns/locale/en-US';
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
  constructor(private exampleComponent: FsExampleComponent,
              private message: FsMessage) {
    exampleComponent.setConfigureComponent(KitchenSinkConfigureComponent, { config: this.config });
    for (let i = 0; i < 12; i++) {
      this.months.push(localize.month(i));
    }

    this.days = range(1, 15);

    this.years = range(2010, 2020);
  }
}
