import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./mercado/mercado').then((m) => m.Mercado) },
  { path: 'arena', loadComponent: () => import('./arena/arena').then((m) => m.Arena) },
  { path: 'atacar', loadComponent: () => import('./attack/attack').then((m) => m.Attack) },
  { path: '**', redirectTo: '' },
];
