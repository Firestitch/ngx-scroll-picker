import { Component } from '@angular/core';
import { environment } from '@env';
import { FsExampleModule } from '@firestitch/example';
import { KitchenSinkComponent } from '../kitchen-sink/kitchen-sink.component';
import { NumericComponent } from '../numeric/numeric.component';
import { DisabledComponent } from '../disabled/disabled.component';
import { InfiniteComponent } from '../infinite/infinite.component';


@Component({
    templateUrl: 'examples.component.html',
    standalone: true,
    imports: [FsExampleModule, KitchenSinkComponent, NumericComponent, DisabledComponent, InfiniteComponent]
})
export class ExamplesComponent {
  public config = environment;
}
