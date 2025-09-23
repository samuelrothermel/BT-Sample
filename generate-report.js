#!/usr/bin/env node

/**
 * Transaction Report Generator
 * Command-line tool to generate Braintree transaction reports
 *
 * Usage:
 *   node generate-report.js [options]
 *
 * Options:
 *   --days <number>     Number of days to look back (default: 1)
 *   --format <type>     Output format: csv, json, table (default: csv)
 *   --output <file>     Output file path (optional, defaults to stdout for table, auto-generated for csv/json)
 *   --help             Show help message
 *
 * Examples:
 *   node generate-report.js --days 7 --format csv
 *   node generate-report.js --days 30 --format json --output monthly-report.json
 *   node generate-report.js --format table
 */

require('dotenv').config();
const braintree = require('braintree');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const options = parseArgs(args);

// Show help if requested
if (options.help) {
  showHelp();
  process.exit(0);
}

// Validate environment variables
if (
  !process.env.BRAINTREE_MERCHANT_ID ||
  !process.env.BRAINTREE_PUBLIC_KEY ||
  !process.env.BRAINTREE_PRIVATE_KEY
) {
  console.error(
    ' Error: Missing Braintree credentials in environment variables'
  );
  console.error('Please ensure your .env file contains:');
  console.error('  BRAINTREE_MERCHANT_ID');
  console.error('  BRAINTREE_PUBLIC_KEY');
  console.error('  BRAINTREE_PRIVATE_KEY');
  console.error('  BRAINTREE_ENVIRONMENT');
  process.exit(1);
}

// Initialize Braintree Gateway
const gateway = new braintree.BraintreeGateway({
  environment:
    process.env.BRAINTREE_ENVIRONMENT === 'production'
      ? braintree.Environment.Production
      : braintree.Environment.Sandbox,
  merchantId: process.env.BRAINTREE_MERCHANT_ID,
  publicKey: process.env.BRAINTREE_PUBLIC_KEY,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY,
});

// Main execution
async function main() {
  try {
    console.log('Generating transaction report...');
    console.log(`Date range: Last ${options.days} days`);
    console.log(`Environment: ${process.env.BRAINTREE_ENVIRONMENT}`);
    console.log(`Format: ${options.format}`);
    console.log('');

    const transactions = await fetchTransactions(options.days);

    console.log(`Found ${transactions.length} transactions`);

    if (transactions.length === 0) {
      console.log('No transactions found for the specified date range.');
      return;
    }

    await generateOutput(transactions, options);
  } catch (error) {
    console.error('Error generating report:', error.message);
    process.exit(1);
  }
}

// Fetch transactions from Braintree
async function fetchTransactions(days) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  console.log(
    `🔎 Searching for transactions settled after: ${startDate.toISOString()}`
  );

  return new Promise((resolve, reject) => {
    gateway.transaction.search(
      search => {
        search.settledAt().min(startDate);
      },
      (err, response) => {
        if (err) {
          reject(err);
          return;
        }

        const transactions = [];
        response.each(transaction => {
          transactions.push({
            id: transaction.id,
            type: transaction.type,
            amount: transaction.amount,
            status: transaction.status,
            created_at: transaction.createdAt,
            service_fee_amount: transaction.serviceFeeAmount || '',
            merchant_account_id: transaction.merchantAccountId || '',
          });
        });

        resolve(transactions);
      }
    );
  });
}

// Generate output in specified format
async function generateOutput(transactions, options) {
  switch (options.format) {
    case 'csv':
      await generateCSV(transactions, options.output);
      break;
    case 'json':
      await generateJSON(transactions, options.output);
      break;
    case 'table':
      generateTable(transactions);
      break;
    default:
      throw new Error(`Unknown format: ${options.format}`);
  }
}

// Generate CSV output
async function generateCSV(transactions, outputFile) {
  const headerRow = [
    'id',
    'type',
    'amount',
    'status',
    'created_at',
    'service_fee_amount',
    'merchant_account_id',
  ];

  let csvContent = headerRow.join(',') + '\n';

  transactions.forEach(transaction => {
    const row = headerRow.map(field => {
      let value = transaction[field] || '';
      // Escape quotes and wrap in quotes if contains comma or quote
      if (
        typeof value === 'string' &&
        (value.includes(',') || value.includes('"'))
      ) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    });
    csvContent += row.join(',') + '\n';
  });

  // Generate filename if not provided
  if (!outputFile) {
    const timestamp = new Date().toISOString().split('T')[0];
    outputFile = `transaction_report_${timestamp}.csv`;
  }

  fs.writeFileSync(outputFile, csvContent);
  console.log(`💾 CSV report saved to: ${path.resolve(outputFile)}`);
}

// Generate JSON output
async function generateJSON(transactions, outputFile) {
  const reportData = {
    generated_at: new Date().toISOString(),
    environment: process.env.BRAINTREE_ENVIRONMENT,
    total_transactions: transactions.length,
    transactions: transactions,
  };

  const jsonContent = JSON.stringify(reportData, null, 2);

  // Generate filename if not provided
  if (!outputFile) {
    const timestamp = new Date().toISOString().split('T')[0];
    outputFile = `transaction_report_${timestamp}.json`;
  }

  fs.writeFileSync(outputFile, jsonContent);
  console.log(`💾 JSON report saved to: ${path.resolve(outputFile)}`);
}

// Generate table output to console
function generateTable(transactions) {
  console.log('\n📋 Transaction Report:');
  console.log('═'.repeat(120));

  // Header
  const headers = [
    'ID',
    'Type',
    'Amount',
    'Status',
    'Created At',
    'Service Fee',
    'Merchant Account',
  ];
  console.log(
    headers[0].padEnd(25) +
      ' │ ' +
      headers[1].padEnd(12) +
      ' │ ' +
      headers[2].padEnd(10) +
      ' │ ' +
      headers[3].padEnd(15) +
      ' │ ' +
      headers[4].padEnd(20) +
      ' │ ' +
      headers[5].padEnd(12) +
      ' │ ' +
      headers[6].padEnd(15)
  );
  console.log('─'.repeat(120));

  // Rows
  transactions.forEach(transaction => {
    const createdAt = transaction.created_at
      ? new Date(transaction.created_at).toLocaleString()
      : 'N/A';
    const amount = '$' + parseFloat(transaction.amount || 0).toFixed(2);
    const serviceFee = transaction.service_fee_amount
      ? '$' + parseFloat(transaction.service_fee_amount).toFixed(2)
      : 'N/A';

    console.log(
      (transaction.id || '').padEnd(25) +
        ' │ ' +
        (transaction.type || '').padEnd(12) +
        ' │ ' +
        amount.padEnd(10) +
        ' │ ' +
        (transaction.status || '').padEnd(15) +
        ' │ ' +
        createdAt.padEnd(20) +
        ' │ ' +
        serviceFee.padEnd(12) +
        ' │ ' +
        (transaction.merchant_account_id || '').padEnd(15)
    );
  });

  console.log('═'.repeat(120));
  console.log(`📊 Total: ${transactions.length} transactions`);
}

// Parse command line arguments
function parseArgs(args) {
  const options = {
    days: 1,
    format: 'csv',
    output: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--days':
        options.days = parseInt(args[++i]) || 1;
        break;
      case '--format':
        options.format = args[++i] || 'csv';
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        showHelp();
        process.exit(1);
    }
  }

  // Validate format
  if (!['csv', 'json', 'table'].includes(options.format)) {
    console.error(
      `Invalid format: ${options.format}. Must be one of: csv, json, table`
    );
    process.exit(1);
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
🔧 Braintree Transaction Report Generator

USAGE:
  node generate-report.js [options]

OPTIONS:
  --days <number>     Number of days to look back (default: 1)
  --format <type>     Output format: csv, json, table (default: csv)
  --output <file>     Output file path (optional, auto-generated for csv/json)
  --help             Show this help message

OUTPUT FORMATS:
  csv       Comma-separated values file (suitable for Excel, Google Sheets)
  json      JSON format with metadata (suitable for APIs, further processing)
  table     Pretty-printed table to console (suitable for quick viewing)

EXAMPLES:
  node generate-report.js
  node generate-report.js --days 7 --format table
  node generate-report.js --days 30 --format csv --output monthly-report.csv
  node generate-report.js --days 90 --format json
  node generate-report.js --format table

ENVIRONMENT:
  Requires .env file with Braintree credentials:
    BRAINTREE_ENVIRONMENT=sandbox
    BRAINTREE_MERCHANT_ID=your_merchant_id
    BRAINTREE_PUBLIC_KEY=your_public_key
    BRAINTREE_PRIVATE_KEY=your_private_key
`);
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  fetchTransactions,
  generateCSV,
  generateJSON,
  generateTable,
};
