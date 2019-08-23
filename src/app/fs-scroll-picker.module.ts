import { NgModule, ModuleWithProviders } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ScrollPickerComponent } from './components/scroll-picker/scroll-picker.component';
import { ScrollPickerTemplateComponent } from './directives/scroll-picker-template.directive';

@NgModule({
  imports: [
    CommonModule,
  ],
  exports: [
    ScrollPickerComponent,
    ScrollPickerTemplateComponent
  ],
  declarations: [
    ScrollPickerComponent,
    ScrollPickerTemplateComponent
  ],
})
export class FsScrollPickerModule {
  static forRoot(): ModuleWithProviders {
    return {
      ngModule: FsScrollPickerModule
    };
  }
}
