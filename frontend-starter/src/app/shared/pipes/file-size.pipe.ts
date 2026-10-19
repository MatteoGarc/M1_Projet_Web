import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Affiche une taille en octets de façon lisible : `3 456 789` → `3,3 Mo`.
 * Le backend renvoie `size` en OCTETS (champ `req.file.size` de Multer) :
 * l'ancien template affichait `{{ track.size }} Ko`, ce qui était faux.
 */
@Pipe({ name: 'fileSize' })
export class FileSizePipe implements PipeTransform {
  transform(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${formatter.format(bytes / 1024)} Ko`;
    return `${formatter.format(bytes / (1024 * 1024))} Mo`;
  }
}
