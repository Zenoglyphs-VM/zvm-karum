import {createRouter, createWebHistory} from 'vue-router'

// Real paths, not hashes: an item page is the thing people share, and
// /item/0xabc…/7 reads as an address and a number rather than a fragment.
// GitHub Pages has no SPA rewrite, so the build leaves a copy of index.html at
// 404.html (vite.config.ts) and unmatched paths boot the app with the URL
// intact.
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: (to, from, saved) => saved ?? (to.path === from.path ? false : {top: 0}),
  routes: [
    {path: '/', name: 'home', component: () => import('./pages/HomePage.vue')},
    {path: '/collections', name: 'collections', component: () => import('./pages/CollectionsPage.vue')},
    {path: '/collection/:address', name: 'collection', component: () => import('./pages/CollectionPage.vue')},
    {path: '/item/:collection/:id', name: 'item', component: () => import('./pages/ItemPage.vue')},
    {path: '/account/:address', name: 'account', component: () => import('./pages/AccountPage.vue')},
    {path: '/activity', name: 'activity', component: () => import('./pages/ActivityPage.vue')},
    {path: '/drops', name: 'drops', component: () => import('./pages/DropsPage.vue')},
    {path: '/create', name: 'create', component: () => import('./pages/CreatePage.vue')},
    {path: '/watchlist', name: 'watchlist', component: () => import('./pages/WatchlistPage.vue')},
    {path: '/about', name: 'about', component: () => import('./pages/AboutPage.vue')},
    {path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./pages/NotFoundPage.vue')},
  ],
})
