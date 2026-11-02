# MASTER Sales Management — design only

User scope: build the page design first; defer data-source work. Standalone preview lives in integration/prototypes/master-sales-management-design-20261102, with Dashboard, Customers and Commission using the existing MASTER blue/grey theme. All customer names, invoices and financial values are synthetic. Preview perspective selector is only a demonstration, not authorization. There are no network requests, parent messages, timers, CMS writes or production entry changes.

Dashboard: Customer, Country, Currency, Term, Current Due, Entry. Customers: compact profile followed by Period, Invoice No/date, Invoice Amount, Payment Status, Cost MYR, Profit MYR, GP, Transport, Comm Status. Commission: Period, Inv, Amount, Cost, Profit, Others Cost, Net Comm. Reserved costs/commission remain dashes; money and GP have two decimals; passive pills are 19px.

Browser review passed: personal2 customers, owner3, customer entry/profile/invoice table, fully paid Commission list, three-page navigation, no captured errors. Actual dashboard/customers/commission PNGs are in the private handoff. Local preview at http://127.0.0.1:9053/ is design-only and has not been deployed to Wix or public Pages. Real salesperson ownership, login, historical attribution, Finance ledger and commission calculation are deferred and must not be inferred from this UI fixture.
