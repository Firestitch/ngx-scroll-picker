import { Component } from '@angular/core';


@Component({
  selector: 'app-disabled',
  templateUrl: 'disabled.component.html',
  styleUrls: ['disabled.component.scss']
})
export class DisabledComponent {

  public config = {};
  public model = new Date('2015-10-10 15:45');
  public months = [];
  public month = (new Date()).getMonth();

}
