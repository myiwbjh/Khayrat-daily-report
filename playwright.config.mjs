import { defineConfig } from '@playwright/test';
const node=`"${process.execPath}"`;
export default defineConfig({ testDir:'./e2e', timeout:30000, use:{baseURL:'http://127.0.0.1:4173',headless:true}, webServer:{command:`${node} scripts/build.mjs && ${node} scripts/serve.mjs`,url:'http://127.0.0.1:4173',reuseExistingServer:false} });
