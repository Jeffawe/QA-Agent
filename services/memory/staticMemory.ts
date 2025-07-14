import * as fs from 'fs';
import * as path from 'path';
import { Analysis, PageDetails } from '../../types';

export class StaticMemory {
  public static pages: PageDetails[] = [];
  public static analysis: Analysis[] = [];

  static addPage(page: PageDetails) {
    if(StaticMemory.pages.some(p => p.uniqueID === page.uniqueID)) return;
    StaticMemory.pages.push(page);
  }
}