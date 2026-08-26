const { CronExpressionParser } = require('cron-parser');

function nextCronRun(expression, timeZone = 'Asia/Tehran', fromDate = new Date()) {
  const cron = String(expression || '').trim();
  if (!cron) return null;
  const interval = CronExpressionParser.parse(cron, { currentDate: fromDate, tz: timeZone });
  return interval.next().toDate();
}

function isValidCron(expression) {
  try {
    CronExpressionParser.parse(String(expression || '').trim());
    return true;
  } catch {
    return false;
  }
}

module.exports = { nextCronRun, isValidCron };
