import { Component } from '@angular/core';


@Component({
  selector: 'kitchen-sink',
  templateUrl: 'kitchen-sink.component.html',
  styleUrls: ['kitchen-sink.component.scss'],
})
export class KitchenSinkComponent {

  public config = {};
  public model = new Date('2015-10-10 15:45');
  public months = [];
  public dayMax = 31;
  public month = (new Date()).getMonth();
  public day = (new Date()).getDate();
  public year = (new Date()).getFullYear();
  public yearMax = (new Date()).getFullYear();

}
