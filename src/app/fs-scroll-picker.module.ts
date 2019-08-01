import { NgModule, ModuleWithProviders } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ScrollPickerComponent } from './components/scroll-picker/scroll-picker.component';

@NgModule({
  imports: [
    CommonModule,
  ],
  exports: [
    ScrollPickerComponent,
  ],
  entryComponents: [
  ],
  declarations: [
    ScrollPickerComponent,
  ],
})
export class FsScrollPickerModule {
  static forRoot(): ModuleWithProviders {
    return {
      ngModule: FsScrollPickerModule
    };
  }
}
