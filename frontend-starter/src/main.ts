import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from './app/components/app/app';
import { appConfig } from './app/app.config';

// Les fournisseurs (routes, HttpClient + intercepteurs) sont dans
// `app/app.config.ts` depuis le TP3, afin de pouvoir les tester.
bootstrapApplication(AppComponent, appConfig).catch(console.error);
