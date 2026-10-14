import { test, expect } from '@playwright/test';

test('overview keeps the three initial milestones responsive and read-only offline',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#milestoneTimeline .milestone-node')).toHaveCount(3);
 await expect(page.locator('#milestoneTimeline')).toContainText('实际现场施工起点');
 await expect(page.locator('#milestoneTimeline')).toContainText('合同工期起算');
 await expect(page.locator('#milestoneTimeline')).toContainText('主要设备安装目标');
 await expect(page.locator('#editMilestones')).toBeHidden();
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#milestoneTimeline')).toBeVisible();
});

test('manual report survives reload and history is collapsed by date',async({page})=>{await page.goto('/#entry');await page.getByRole('link',{name:'日报录入'}).click();await page.locator('[name="date"]').fill('2026-09-07');await page.locator('[name="workshop"]').fill('水泥粉磨车间');await page.locator('[name="process"]').fill('设备基础');await page.locator('[name="activityId"]').fill('A-001');await page.locator('[name="wbsWeight"]').fill('1');await page.locator('[name="actualProgress"]').fill('12');await page.getByRole('button',{name:'保存日报'}).click();await expect(page.getByText('日报已保存到当前浏览器 IndexedDB')).toBeVisible();await page.reload();await page.getByRole('link',{name:'日报录入'}).click();const toggle=page.locator('[data-history-toggle="2026-09-07"]');await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(page.locator('[data-history-date="2026-09-07"]')).toBeHidden();await toggle.click();await expect(page.locator('[data-history-date="2026-09-07"]')).toBeVisible();await expect(page.locator('#historyRows')).toContainText('A-001');});

test('import preview can cancel without changing records',async({page})=>{await page.goto('/');const csv='日报名称,日期,车间,工序,活动编号,实际进度\nE2E,2026-09-08,粉磨车间,基础,A-002,10';await page.locator('#fileInput').setInputFiles({name:'e2e.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await expect(page.getByRole('heading',{name:'导入前预览'})).toBeVisible();await page.getByRole('button',{name:'取消'}).click();await expect(page.locator('#recordCount')).toContainText('0 条');});

test('navigation keeps every page isolated and resolves dashboard anchors',async({page})=>{
 await page.goto('/#entry');
 await expect(page.locator('#entryView')).toBeVisible();
 await expect(page.locator('#overviewView')).toBeHidden();
 await expect(page.locator('#dataView')).toBeHidden();
 await page.getByRole('link',{name:'日报对比'}).click();
 await expect(page.locator('#compareView')).toBeVisible();
 await expect(page.locator('#entryView')).toBeHidden();
 await expect(page.locator('#imagesView')).toBeHidden();
 await page.getByRole('link',{name:'数据导入与工程量'}).click();
 await expect(page.locator('#dataView')).toBeVisible();
 await expect(page.locator('#overviewView')).toBeHidden();
 await expect(page).toHaveURL(/#import$/);
 await page.getByRole('link',{name:'车间状态与预警'}).click();
 await expect(page.locator('#workshopsView')).toBeVisible();
 await expect(page.locator('#overviewView')).toBeHidden();
 await expect(page.locator('#dataView')).toBeHidden();
 await expect(page).toHaveURL(/#workshops$/);
 await page.getByRole('link',{name:'设备跟踪'}).click();
 await expect(page.locator('#equipmentView')).toBeVisible();
 await expect(page.locator('#equipmentView')).toContainText('尚未导入设备箱单');
 await expect(page.locator('#shipmentPackageKpi')).toHaveText('0');
 await page.getByRole('link',{name:'风险与制约'}).click();
 await expect(page.locator('#risksView')).toBeVisible();
 await expect(page.locator('#risksView')).toContainText('暂无匹配风险');
 await expect(page.locator('#riskActiveKpi')).toHaveText('0');
 await page.goto('/#evidence');
 await expect(page.locator('#workshopsView')).toBeVisible();
 await expect(page).toHaveURL(/#workshops$/);
 await page.goto('/#removed-link');
 await expect(page.locator('#overviewView')).toBeVisible();
 await expect(page.getByRole('link',{name:'工程总览'})).toHaveClass(/active/);
 await expect(page).toHaveURL(/#overview$/);
});
