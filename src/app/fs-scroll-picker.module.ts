import { NgModule } from '@angular/core';

import { ScrollPickerNumericComponent } from './components/scroll-picker-numeric/scroll-picker-numeric.component';
import { ScrollPickerComponent } from './components/scroll-picker/scroll-picker.component';
import { ScrollPickerTemplateComponent } from './directives/scroll-picker-template.directive';


/**
 * Compatibility module for consumers that still import FsScrollPickerModule.
 *
 * The components went standalone in 18.0.2, which dropped this module and broke
 * every consumer built against the old surface — @firestitch/datepicker 18.0.27
 * imports it and its ^18.0.0 range resolves straight to the version without it.
 * Standalone components cannot be declared, only imported and re-exported, so
 * this is a pass-through rather than the original declarations block.
 *
 * Import the components directly in new code.
 */
@NgModule({
  imports: [
    ScrollPickerComponent,
    ScrollPickerNumericComponent,
    ScrollPickerTemplateComponent,
  ],
  exports: [
    ScrollPickerComponent,
    ScrollPickerNumericComponent,
    ScrollPickerTemplateComponent,
  ],
})
export class FsScrollPickerModule {}
