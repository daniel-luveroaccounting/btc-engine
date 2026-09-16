/* ===========================================================================
   LUVERO TOOLS - SHARED RATES FILE
   ---------------------------------------------------------------------------
   Every tax figure used by every calculator on businesstaxcalculator.co.uk
   lives in this one file. Nothing else hard-codes a rate or a threshold.

   England, Wales and Northern Ireland. Scottish income tax rates are not
   modelled.

   OWNER OF THE CONTENT:  Dan Edwards
   OWNER OF THE DIARY:    SJ (06/04 each year, and Budget day)
   RATES LAST CHECKED:    16/09/2026
   CHECKED AGAINST:       GOV.UK (see SOURCES at the foot of this file)

   TO UPDATE FOR A NEW YEAR: copy a year block, rename the key (e.g.
   "2027/28"), change the numbers, update RATES_LAST_CHECKED, and re-run the
   test file (tests.html). Do not edit rates anywhere else.
   =========================================================================== */

var LUVERO_RATES_LAST_CHECKED = "16/09/2026";
var LUVERO_DEFAULT_YEAR = "2026/27";

var LUVERO_RATES = {

  "2025/26": {
    label: "2025/26",

    /* --- Income tax ------------------------------------------------------ */
    personalAllowance:    12570,   // standard personal allowance
    paTaperStart:        100000,   // PA cut by £1 for every £2 of income above
    basicRateBand:        37700,   // width of the 20% band (taxable income)
    additionalThreshold: 125140,   // taxable income at which 45% starts
    incomeRates:  { basic: 0.20,   higher: 0.40,   additional: 0.45 },

    /* --- Dividends ------------------------------------------------------- */
    dividendAllowance: 500,
    dividendRates: { basic: 0.0875, higher: 0.3375, additional: 0.3935 },

    /* --- Class 1 National Insurance -------------------------------------- */
    niEmployee: { primary: 12570, uel: 50270, main: 0.08, upper: 0.02, lel: 6500 },
    niEmployer: { secondary: 5000, rate: 0.15, employmentAllowance: 10500 },

    /* --- Self-employed National Insurance (sole trader comparison) ------- */
    class4: { lpl: 12570, upl: 50270, main: 0.06, upper: 0.02 },
    class2: { weekly: 3.50, spt: 6845 },          // treated as paid at or above the SPT

    /* --- Benefits in kind ------------------------------------------------ */
    class1A: 0.15,

    /* --- Student loan repayment thresholds (annual) ---------------------- */
    /* Plan 5 loans are not repayable until 06/04/2026, so no 2025/26 figure. */
    studentLoan: { plan1: 26065, plan2: 28470, plan4: 32745, plan5: null, postgrad: 21000,
                   rate: 0.09, postgradRate: 0.06 },


    /* --- Loans to participators and beneficial loans (phase 7) ---------- */
    s455Rate: 0.3375,                 // CTM61505: 33.75% for loans made from 06/04/2022
    officialRate: 0.0375,             // HMRC official rate of interest, whole year
    loanBenefitThreshold: 10000,      // no benefit in kind if all loans stay at or under this

    /* --- Company cars (phase 7) ------------------------------------------ */
    /* Appropriate percentages for cars registered from 06/04/2020, 480
       Appendix 2. `range` is the 1 to 50g band by electric range (lower bound
       of range in miles, percentage). `bands` are lower bounds of CO2 in g/km. */
    car: {
      zero: 0.03,
      range: [[130, 0.03], [70, 0.06], [40, 0.09], [30, 0.13], [0, 0.15]],
      bands: [[51, 0.16], [55, 0.17], [60, 0.18], [65, 0.19], [70, 0.20], [75, 0.21], [80, 0.22],
              [85, 0.23], [90, 0.24], [95, 0.25], [100, 0.26], [105, 0.27], [110, 0.28], [115, 0.29],
              [120, 0.30], [125, 0.31], [130, 0.32], [135, 0.33], [140, 0.34], [145, 0.35],
              [150, 0.36], [155, 0.37]],
      dieselSupplement: 0.04,         // non-RDE2 diesels, capped at max
      max: 0.37,
      fuelMultiplier: 28200,          // car fuel benefit fixed figure, s150 ITEPA
      capitalContributionCap: 5000
    },

    /* --- Approved mileage allowance payments, cars (phase 7) ------------- */
    amap: { first: 0.45, after: 0.25, threshold: 10000 },

    /* --- Corporation tax (financial year starting 01/04/2025) ------------ */
    corpTax: {
      smallRate:  0.19,
      mainRate:   0.25,
      lowerLimit: 50000,
      upperLimit: 250000,
      fraction:   3 / 200      // marginal relief standard fraction
    }
  },

  "2026/27": {
    label: "2026/27",

    /* --- Income tax ------------------------------------------------------ */
    personalAllowance:    12570,
    paTaperStart:        100000,
    basicRateBand:        37700,
    additionalThreshold: 125140,
    incomeRates:  { basic: 0.20,   higher: 0.40,   additional: 0.45 },

    /* --- Dividends ------------------------------------------------------- */
    /* Ordinary and upper rates rose by 2 percentage points from 06/04/2026
       (Autumn Budget 2025). The additional rate was unchanged. */
    dividendAllowance: 500,
    dividendRates: { basic: 0.1075, higher: 0.3575, additional: 0.3935 },

    /* --- Class 1 National Insurance -------------------------------------- */
    niEmployee: { primary: 12570, uel: 50270, main: 0.08, upper: 0.02, lel: 6708 },   // lel: Lower Earnings Limit, quoted in page text only
    niEmployer: { secondary: 5000, rate: 0.15, employmentAllowance: 10500 },

    /* --- Self-employed National Insurance (sole trader comparison) ------- */
    class4: { lpl: 12570, upl: 50270, main: 0.06, upper: 0.02 },
    class2: { weekly: 3.65, spt: 7105 },          // treated as paid at or above the SPT

    /* --- Benefits in kind ------------------------------------------------ */
    class1A: 0.15,

    /* --- Student loan repayment thresholds (annual) ---------------------- */
    studentLoan: { plan1: 26900, plan2: 29385, plan4: 33795, plan5: 25000, postgrad: 21000,
                   rate: 0.09, postgradRate: 0.06 },


    /* --- Loans to participators and beneficial loans (phase 7) ---------- */
    s455Rate: 0.3575,                 // CTM61505: 35.75% for loans made from 06/04/2026
    officialRate: 0.0375,
    loanBenefitThreshold: 10000,

    /* --- Company cars (phase 7) ------------------------------------------ */
    car: {
      zero: 0.04,
      range: [[130, 0.04], [70, 0.07], [40, 0.10], [30, 0.14], [0, 0.16]],
      bands: [[51, 0.17], [55, 0.18], [60, 0.19], [65, 0.20], [70, 0.21], [75, 0.21], [80, 0.22],
              [85, 0.23], [90, 0.24], [95, 0.25], [100, 0.26], [105, 0.27], [110, 0.28], [115, 0.29],
              [120, 0.30], [125, 0.31], [130, 0.32], [135, 0.33], [140, 0.34], [145, 0.35],
              [150, 0.36], [155, 0.37]],
      dieselSupplement: 0.04,
      max: 0.37,
      fuelMultiplier: 29200,          // from 06/04/2026, September 2025 CPI uprating
      capitalContributionCap: 5000
    },

    /* --- Approved mileage allowance payments, cars (phase 7) ------------- */
    /* The first-10,000-mile rate rose from 45p to 55p on 06/04/2026. */
    amap: { first: 0.55, after: 0.25, threshold: 10000 },

    /* --- Corporation tax (financial year starting 01/04/2026) ------------ */
    corpTax: {
      smallRate:  0.19,
      mainRate:   0.25,
      lowerLimit: 50000,
      upperLimit: 250000,
      fraction:   3 / 200
    }
  }

};

/* ===========================================================================
   SOURCES, checked 15/09/2026 (16/09/2026 for the self-employed, benefit
   and student loan figures)
   ---------------------------------------------------------------------------
   Income tax allowances and thresholds, both years
     gov.uk/government/publications/rates-and-allowances-income-tax
   Dividend rates and allowance, 2026/27
     gov.uk/tax-on-dividends
   Class 1 NI thresholds and rates, and Employment Allowance, 2026/27
     gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
   Corporation tax rates, limits and the 3/200 marginal relief fraction,
   financial years 2025 and 2026
     gov.uk/government/publications/rates-and-allowances-corporation-tax
   Dividend rates 2025/26, and the 2 point rise from 06/04/2026
     gov.uk/government/publications/changes-to-tax-rates-for-property-savings-
     and-dividend-income/change-to-tax-rates-for-property-savings-and-dividend-
     income-technical-note
   Class 2 rate, Small Profits Threshold, Class 4 limits and rates, both years
     gov.uk/government/publications/rates-and-allowances-national-insurance-
     contributions
   Student loan and postgraduate loan thresholds, Class 1A rate, both years
     gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026
     gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
   Phase 7, checked 16/09/2026:
   s455 rate, 33.75% then 35.75% from 06/04/2026
     gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm61505
   Official rate of interest, 3.75% both years
     gov.uk/government/publications/rates-and-allowances-beneficial-loan-
     arrangements-hmrc-official-rates
   Loan benefit threshold £10,000
     gov.uk/directors-loans/you-owe-your-company-money
   Company car appropriate percentages, both years
     gov.uk/guidance/company-car-benefit-the-appropriate-percentage-480-appendix-2
   Diesel supplement and RDE2 exemption
     gov.uk/hmrc-internal-manuals/employment-income-manual/eim24730
   Car fuel benefit multiplier £28,200 (2025/26) and £29,200 (2026/27)
     gov.uk/guidance/taxable-fuel-provided-for-company-cars-and-vans-480-chapter-13
     gov.uk/government/publications/increase-to-van-benefit-charge-and-fuel-
     benefit-charges-for-cars-and-vans
   Approved mileage rates, 45p then 55p from 06/04/2026, 25p after 10,000 miles
     gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
   =========================================================================== */
