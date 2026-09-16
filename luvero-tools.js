/* ===========================================================================
   LUVERO TOOLS - SHARED ENGINE AND PAGE FURNITURE
   ---------------------------------------------------------------------------
   businesstaxcalculator.co.uk. Loaded on every page, after rates.js.

   Contains:
     1) Formatting helpers
     2) The tax engine (income tax, NI, dividends, corporation tax, extraction)
     3) The disclaimer block, identical on every tool
     4) The capture block, identical on every tool
     5) Header and footer
     6) Small bar chart renderer

   No rate or threshold is hard-coded here. Everything comes from rates.js.
   =========================================================================== */

"use strict";

var LV = (function () {

  /* =========================================================================
     0) CONFIGURATION
     -------------------------------------------------------------------------
     The capture form is the ClientMax form "Tools site capture", embedded in
     section 4 below. Its id lives there. Contacts are tagged by the workflow
     "Tools site capture (tools-lead)", not by anything in this file.
     ========================================================================= */
  var CAPTURE_TAG = "tools-lead";     // recorded here for reference only
  var PARENT_SITE = "https://luvero.uk";

  /* =========================================================================
     1) HELPERS
     ========================================================================= */
  function num(v) {
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function gbp(v) {
    var neg = v < 0;
    return (neg ? "-£" : "£") + Math.abs(Math.round(v)).toLocaleString("en-GB");
  }

  function gbpExact(v) {
    var neg = v < 0;
    return (neg ? "-£" : "£") + Math.abs(v).toLocaleString("en-GB", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function pct(v, dp) {
    return (v * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function rates(year) {
    var C = LUVERO_RATES[year];
    if (!C) throw new Error("No rates held for tax year " + year);
    return C;
  }

  function years() { return Object.keys(LUVERO_RATES); }

  /* Format a money input in place, so the visitor sees 60,000 not 60000. */
  function bindMoneyInput(el, onChange) {
    function tidy() {
      var n = num(el.value);
      el.value = n ? n.toLocaleString("en-GB") : "";
    }
    el.addEventListener("input", onChange);
    el.addEventListener("blur", function () { tidy(); onChange(); });
  }

  /* =========================================================================
     2) TAX ENGINE
     -------------------------------------------------------------------------
     England, Wales and Northern Ireland. Income is taxed in the statutory
     order: non-savings income first, then dividends as the top slice.
     Allowances taxed at 0% still use up band width, so a running position is
     tracked through the bands.

     Savings interest, capital gains, Scottish rates, student loans, the High
     Income Child Benefit Charge and pension contributions are out of scope for
     these four public tools. They are handled in the internal Tax Planner.
     ========================================================================= */

  /* Band ceilings expressed in taxable income (income after the allowance). */
  function bands(C) {
    return [C.basicRateBand, C.additionalThreshold, Infinity];
  }

  /* Tax `amount`, starting from cumulative band position `cum`. */
  function taxSlice(amount, rateList, cum, bandList) {
    var tax = 0, remaining = amount, pos = cum;
    for (var i = 0; i < bandList.length && remaining > 1e-6; i++) {
      if (pos >= bandList[i]) continue;
      var slice = Math.min(remaining, bandList[i] - pos);
      tax += slice * rateList[i];
      pos += slice;
      remaining -= slice;
    }
    return tax;
  }

  /* Personal allowance, after the £100k taper. */
  function personalAllowance(adjustedNetIncome, C) {
    if (adjustedNetIncome <= C.paTaperStart) return C.personalAllowance;
    return Math.max(0, C.personalAllowance - (adjustedNetIncome - C.paTaperStart) / 2);
  }

  /* Income tax on salary plus other non-savings income plus dividends. */
  function personalTax(salary, otherIncome, dividends, year) {
    var C = rates(year);
    var nonSavings = salary + otherIncome;
    var total = nonSavings + dividends;
    var pa = personalAllowance(total, C);

    var paLeft = pa;
    var nsAfterPA  = Math.max(0, nonSavings - paLeft);
    paLeft = Math.max(0, paLeft - nonSavings);
    var divAfterPA = Math.max(0, dividends - paLeft);

    var B = bands(C);
    var cum = 0;

    var nsTax = taxSlice(nsAfterPA,
      [C.incomeRates.basic, C.incomeRates.higher, C.incomeRates.additional], cum, B);
    cum += nsAfterPA;

    /* Dividend allowance is taxed at 0% but still uses band width. */
    var divAllowUsed = Math.min(C.dividendAllowance, divAfterPA);
    cum += divAllowUsed;
    var divTaxable = divAfterPA - divAllowUsed;

    var divTax = taxSlice(divTaxable,
      [C.dividendRates.basic, C.dividendRates.higher, C.dividendRates.additional], cum, B);

    return {
      personalAllowance: pa,
      nonSavingsTax: nsTax,
      dividendTax: divTax,
      incomeTax: nsTax + divTax,
      dividendAllowanceUsed: divAllowUsed
    };
  }

  /* Employee Class 1 National Insurance on a salary. */
  function employeeNI(salary, year) {
    var e = rates(year).niEmployee;
    return Math.max(0, Math.min(salary, e.uel) - e.primary) * e.main
         + Math.max(0, salary - e.uel) * e.upper;
  }

  /* Employer Class 1 secondary NI, optionally net of the Employment Allowance. */
  function employerNI(salary, year, useEmploymentAllowance) {
    var r = rates(year).niEmployer;
    var ni = Math.max(0, salary - r.secondary) * r.rate;
    if (useEmploymentAllowance) ni = Math.max(0, ni - r.employmentAllowance);
    return ni;
  }

  /* Corporation tax, with marginal relief between the limits. */
  function corporationTax(profit, year) {
    var c = rates(year).corpTax;
    if (profit <= 0) return 0;
    if (profit <= c.lowerLimit) return profit * c.smallRate;
    if (profit >= c.upperLimit) return profit * c.mainRate;
    return profit * c.mainRate - (c.upperLimit - profit) * c.fraction;
  }

  /* Days in an accounting period, both dates inclusive. Returns 0 if either
     date is missing or the end is before the start. */
  function periodDays(startISO, endISO) {
    if (!startISO || !endISO) return 0;
    var a = new Date(startISO + "T00:00:00Z"), b = new Date(endISO + "T00:00:00Z");
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  /* The fraction of the £50,000 and £250,000 limits available to a period.
     CTA 2010 s24(4): for an accounting period of less than 12 months the
     limits are proportionately reduced. A full year, including a 366 day leap
     year, gets the whole limit. Days beyond a year are ignored here because a
     period over 12 months is split into two accounting periods by law, which
     this tool does not attempt. */
  function periodFraction(days) {
    if (!days || days >= 365) return 1;
    return days / 365;
  }

  /* Full corporation tax breakdown, for the corporation tax page.
     `days` is the length of the accounting period; omit it for 12 months. */
  function corporationTaxDetail(profit, year, associates, days) {
    var c = rates(year).corpTax;
    var n = Math.max(1, Math.floor(associates || 1));
    var pf = periodFraction(days);
    var lower = c.lowerLimit * pf / n;
    var upper = c.upperLimit * pf / n;

    var band, tax, relief = 0;
    if (profit <= 0) {
      band = "none"; tax = 0;
    } else if (profit <= lower) {
      band = "small"; tax = profit * c.smallRate;
    } else if (profit >= upper) {
      band = "main"; tax = profit * c.mainRate;
    } else {
      band = "marginal";
      relief = (upper - profit) * c.fraction;
      tax = profit * c.mainRate - relief;
    }

    return {
      profit: profit,
      tax: tax,
      relief: relief,
      band: band,
      lowerLimit: lower,
      upperLimit: upper,
      associates: n,
      periodDays: days || 0,
      periodFraction: pf,
      longPeriod: !!(days && days > 366),
      effectiveRate: profit > 0 ? tax / profit : 0,
      marginalRate: c.mainRate + c.fraction,   /* 26.5% inside the relief band */
      profitAfterTax: profit - tax
    };
  }

  /* Company profit needed before corporation tax to leave `net` as dividends. */
  function profitForDividend(net, year) {
    if (net <= 0) return 0;
    var lo = net, hi = net / 0.74 + 1;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (mid - corporationTax(mid, year) < net) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* One salary and dividend route out of a fixed company profit. */
  function extraction(profit, salary, otherIncome, year, useEA, pension) {
    var pen = Math.max(0, pension || 0);
    var erNI = employerNI(salary, year, useEA);
    var taxableProfit = Math.max(0, profit - salary - erNI - pen);
    var ct = corporationTax(taxableProfit, year);
    var dividends = Math.max(0, taxableProfit - ct);

    var pt = personalTax(salary, otherIncome, dividends, year);
    var otherTax = personalTax(0, otherIncome, 0, year).incomeTax;
    var extractionIncomeTax = pt.incomeTax - otherTax;
    var eeNI = employeeNI(salary, year);

    var net = salary + dividends - extractionIncomeTax - eeNI;
    var totalTax = ct + erNI + extractionIncomeTax + eeNI;

    return {
      salary: salary,
      dividends: dividends,
      employerNI: erNI,
      employeeNI: eeNI,
      taxableProfit: taxableProfit,
      corporationTax: ct,
      incomeTax: extractionIncomeTax,
      netToDirector: net,
      totalTax: totalTax,
      effectiveRate: profit > 0 ? totalTax / profit : 0,
      pension: pen,
      profit: profit
    };
  }

  /* The salary levels worth comparing for a given year. */
  function candidateSalaries(year, extra) {
    var C = rates(year);
    var set = {};
    [0, C.niEmployer.secondary, C.niEmployee.primary, C.personalAllowance, 9100]
      .concat(extra || [])
      .forEach(function (s) { if (s >= 0) set[Math.round(s)] = true; });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  /* Dividends needed to leave the director with `target` net cash. */
  function dividendForNet(salary, otherIncome, target, year) {
    var otherTax = personalTax(0, otherIncome, 0, year).incomeTax;
    var eeNI = employeeNI(salary, year);
    function netAt(div) {
      var pt = personalTax(salary, otherIncome, div, year);
      return salary + div - (pt.incomeTax - otherTax) - eeNI;
    }
    if (netAt(0) >= target) return 0;
    var lo = 0, hi = Math.max(target * 5, 200000) + 200000;
    for (var i = 0; i < 90; i++) {
      var mid = (lo + hi) / 2;
      if (netAt(mid) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* Cost to the company of delivering `target` net cash on a given salary. */
  function routeForTarget(salary, otherIncome, target, year, useEA, pension) {
    var pen = Math.max(0, pension || 0);
    var dividends = dividendForNet(salary, otherIncome, target, year);
    var erNI = employerNI(salary, year, useEA);
    var preTaxForDiv = profitForDividend(dividends, year);
    var ct = corporationTax(preTaxForDiv, year);
    var otherTax = personalTax(0, otherIncome, 0, year).incomeTax;
    var pt = personalTax(salary, otherIncome, dividends, year);
    var incomeTax = pt.incomeTax - otherTax;
    var eeNI = employeeNI(salary, year);
    var costToCompany = salary + erNI + preTaxForDiv + pen;

    return {
      salary: salary,
      dividends: dividends,
      employerNI: erNI,
      employeeNI: eeNI,
      corporationTax: ct,
      incomeTax: incomeTax,
      pension: pen,
      netToDirector: salary + dividends - incomeTax - eeNI,
      costToCompany: costToCompany,
      totalTax: ct + erNI + eeNI + incomeTax,
      effectiveRate: costToCompany > 0 ? (ct + erNI + eeNI + incomeTax) / costToCompany : 0
    };
  }

  /* -------------------------------------------------------------------------
     Sole trader side, for the sole trader vs limited company comparison.
     ------------------------------------------------------------------------- */

  /* Class 4 National Insurance on trading profit. */
  function class4NI(profit, year) {
    var c = rates(year).class4;
    return Math.max(0, Math.min(profit, c.upl) - c.lpl) * c.main
         + Math.max(0, profit - c.upl) * c.upper;
  }

  /* Class 2 position. Nothing is payable: at or above the Small Profits
     Threshold contributions are treated as paid; below it they are voluntary.
     Returned for the page text, never deducted. */
  function class2Position(profit, year) {
    var c = rates(year).class2;
    return {
      treatedAsPaid: profit >= c.spt,
      voluntaryAnnual: c.weekly * 52,
      weekly: c.weekly,
      spt: c.spt
    };
  }

  /* A sole trader keeping `profit`, with `otherIncome` taxed underneath it. */
  function soleTrader(profit, otherIncome, year) {
    var p = Math.max(0, profit);
    var otherTax = personalTax(0, otherIncome, 0, year).incomeTax;
    var pt = personalTax(p, otherIncome, 0, year);
    var incomeTax = pt.incomeTax - otherTax;
    var c4 = class4NI(p, year);
    return {
      profit: p,
      incomeTax: incomeTax,
      class4: c4,
      class2: class2Position(p, year),
      personalAllowance: pt.personalAllowance,
      totalTax: incomeTax + c4,
      net: p - incomeTax - c4,
      effectiveRate: p > 0 ? (incomeTax + c4) / p : 0
    };
  }

  /* The same profit run through a company.
       extraCost  the visitor's own figure for the additional cost of running a
                  company (accounts, filing), treated as a deductible expense
       retain     profit to leave in the company after Corporation Tax rather
                  than pay out as dividend
     The sole trader is taxed on all profit whether spent or not, so the fair
     comparison shows the director's take-home and the retained amount
     separately, and their sum. Retained profit is not tax-free: it bears
     dividend tax when it is eventually drawn, so the comparison nets it at
     the basic dividend rate for the year, on the assumption that it comes
     out in a later year inside the basic band. The gross figure is returned
     as well. */
  function companyRoute(profit, salary, otherIncome, year, useEA, extraCost, retain) {
    var cost = Math.max(0, extraCost || 0);
    var avail = Math.max(0, profit - cost);
    var sal = Math.min(Math.max(0, salary), avail);
    var erNI = employerNI(sal, year, useEA);
    if (sal + erNI > avail) { sal = Math.max(0, avail - erNI); erNI = employerNI(sal, year, useEA); }
    var taxableProfit = Math.max(0, avail - sal - erNI);
    var ct = corporationTax(taxableProfit, year);
    var postCT = taxableProfit - ct;
    var kept = Math.min(Math.max(0, retain || 0), postCT);
    var dividends = postCT - kept;

    var pt = personalTax(sal, otherIncome, dividends, year);
    var otherTax = personalTax(0, otherIncome, 0, year).incomeTax;
    var incomeTax = pt.incomeTax - otherTax;
    var eeNI = employeeNI(sal, year);
    var net = sal + dividends - incomeTax - eeNI;
    var retainedTax = kept * rates(year).dividendRates.basic;
    var retainedNet = kept - retainedTax;
    var totalTax = ct + erNI + incomeTax + eeNI;

    return {
      grossProfit: profit,
      extraCost: cost,
      salary: sal,
      employerNI: erNI,
      taxableProfit: taxableProfit,
      corporationTax: ct,
      retained: kept,
      retainedTax: retainedTax,
      retainedNet: retainedNet,
      dividends: dividends,
      incomeTax: incomeTax,
      employeeNI: eeNI,
      netToDirector: net,
      combined: net + retainedNet,
      totalTax: totalTax,
      totalCost: totalTax + cost,
      effectiveRate: profit > 0 ? (totalTax + cost) / profit : 0
    };
  }

  /* Where the two structures cross, on the visitor's own settings, comparing
     the sole trader's net with the company's combined figure (take-home plus
     profit retained). Scans from £10,000 to `maxProfit` in £250 steps and
     bisects each change of sign to within £1. Returns an array of
     { profit, companyAheadAbove } in ascending order; empty if the lead never
     changes hands. The caller decides what to say. */
  function breakevenProfit(salary, otherIncome, year, useEA, extraCost, retain, maxProfit) {
    var hi = maxProfit || 500000, step = 250;
    function diff(p) {
      return companyRoute(p, salary, otherIncome, year, useEA, extraCost, retain).combined
           - soleTrader(p, otherIncome, year).net;
    }
    var out = [], prevP = 10000, prev = diff(prevP);
    for (var p = prevP + step; p <= hi; p += step) {
      var d = diff(p);
      if ((prev < 0 && d >= 0) || (prev >= 0 && d < 0)) {
        var lo = prevP, up = p, dl = prev;
        for (var i = 0; i < 40; i++) {
          var mid = (lo + up) / 2, dm = diff(mid);
          if ((dl < 0 && dm < 0) || (dl >= 0 && dm >= 0)) { lo = mid; dl = dm; } else { up = mid; }
        }
        out.push({ profit: (lo + up) / 2, companyAheadAbove: d >= 0 });
      }
      prev = d; prevP = p;
    }
    return out;
  }

  /* -------------------------------------------------------------------------
     Dividend tax detail: how a dividend splits across the 0%, basic, higher
     and additional bands once salary and other income have used up their
     share of the allowance and bands.
     ------------------------------------------------------------------------- */
  function dividendBands(salary, otherIncome, dividends, year) {
    var C = rates(year);
    var pa = personalAllowance(salary + otherIncome + dividends, C);
    var nonSavings = salary + otherIncome;
    var nsAfterPA = Math.max(0, nonSavings - pa);
    var paLeft = Math.max(0, pa - nonSavings);
    var divAfterPA = Math.max(0, dividends - paLeft);
    var covered = dividends - divAfterPA;
    var out = [];
    if (covered > 0) out.push({ key: "pa", name: "Covered by the Personal Allowance", amount: covered, rate: 0, tax: 0 });
    var allow = Math.min(C.dividendAllowance, divAfterPA);
    if (allow > 0) out.push({ key: "allowance", name: "Dividend allowance", amount: allow, rate: 0, tax: 0 });
    var cum = nsAfterPA + allow, left = divAfterPA - allow;
    var ceilings = bands(C), names = ["Basic rate", "Higher rate", "Additional rate"];
    var keys = ["basic", "higher", "additional"];
    var rl = [C.dividendRates.basic, C.dividendRates.higher, C.dividendRates.additional];
    for (var i = 0; i < 3 && left > 1e-6; i++) {
      if (cum >= ceilings[i]) continue;
      var slice = Math.min(left, ceilings[i] - cum);
      out.push({ key: keys[i], name: names[i], amount: slice, rate: rl[i], tax: slice * rl[i] });
      cum += slice; left -= slice;
    }
    var total = out.reduce(function (t, b) { return t + b.tax; }, 0);
    /* Marginal rate on the next £1 of dividend. */
    var next = personalTax(salary, otherIncome, dividends + 1, year).incomeTax
             - personalTax(salary, otherIncome, dividends, year).incomeTax;
    return { bands: out, tax: total, personalAllowance: pa, marginalRate: Math.max(0, next),
             effectiveRate: dividends > 0 ? total / dividends : 0 };
  }

  /* -------------------------------------------------------------------------
     Student loan repayments, as collected through Self Assessment for someone
     with company income. Earned income always counts. Unearned income
     (dividends, rent, interest) counts in full once it is over £2,000 in the
     year, and not at all at £2,000 or below.
     ------------------------------------------------------------------------- */
  function studentLoan(salary, unearned, plan, postgrad, year) {
    var sl = rates(year).studentLoan;
    var income = salary + (unearned > 2000 ? unearned : 0);
    var out = { plan: plan || "none", postgrad: !!postgrad, planRepayment: 0, postgradRepayment: 0,
                total: 0, incomeCounted: income, threshold: null,
                unearnedIgnored: unearned > 0 && unearned <= 2000 };
    var th = plan && plan !== "none" ? sl[plan] : null;
    if (th !== null && th !== undefined) {
      out.threshold = th;
      out.planRepayment = Math.max(0, income - th) * sl.rate;
    }
    if (postgrad) out.postgradRepayment = Math.max(0, income - sl.postgrad) * sl.postgradRate;
    out.total = out.planRepayment + out.postgradRepayment;
    return out;
  }

  /* Class 1A employer National Insurance on the taxable value of benefits. */
  function class1A(benefitValue, year) {
    return Math.max(0, benefitValue || 0) * rates(year).class1A;
  }

  /* =========================================================================
     PHASE 7: EMPLOYER NI, DIRECTOR'S LOAN, COMPANY CAR
     ========================================================================= */

  /* Employer NI across a payroll. `salaries` is an array of annual gross
     salaries. The Employment Allowance is set against the total, capped at
     the allowance and at the liability. Eligibility (not a sole-director
     company, secondary liability under £100,000 last year) is the caller's
     question; the engine only does the arithmetic. */
  function payrollEmployerNI(salaries, year, useEA) {
    var r = rates(year).niEmployer;
    var rows = (salaries || []).map(function (s) {
      var sal = Math.max(0, num(s));
      return { salary: sal, ni: Math.max(0, sal - r.secondary) * r.rate };
    });
    var totalSalary = rows.reduce(function (a, x) { return a + x.salary; }, 0);
    var gross = rows.reduce(function (a, x) { return a + x.ni; }, 0);
    var relief = useEA ? Math.min(gross, r.employmentAllowance) : 0;
    return {
      rows: rows,
      totalSalary: totalSalary,
      gross: gross,
      employmentAllowance: relief,
      net: gross - relief,
      totalCost: totalSalary + gross - relief,
      aboveThreshold: rows.filter(function (x) { return x.ni > 0; }).length,
      secondary: r.secondary,
      rate: r.rate
    };
  }

  /* Add months to an ISO date, clamping to the month end (31 May + 9 months
     is 28/29 February, then + 1 day is 1 March). */
  function addMonthsAndDays(iso, months, days) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + months, 1));
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(p[2], last));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /* Director's loan account. Everything is for one loan outstanding for the
     whole tax year at a constant balance, which is the simple case the
     calculator explains; averaging rules for moving balances are outside it.
       loan            balance owed to the company
       repaidBeforeDue true if cleared within 9 months and 1 day of the year end
       interestRate    rate the director actually pays the company (decimal)
       yearEnd         company accounting date, ISO
       salary, other, dividends   the director's other income, for the
                                  marginal rate on the benefit and on a
                                  clearing dividend */
  function directorsLoan(o) {
    var C = rates(o.year);
    var loan = Math.max(0, num(o.loan));
    var s455 = o.repaidBeforeDue ? 0 : loan * C.s455Rate;
    var dueDate = o.yearEnd ? addMonthsAndDays(o.yearEnd, 9, 1) : null;

    var bik = 0;
    if (loan > C.loanBenefitThreshold) {
      bik = Math.max(0, loan * (C.officialRate - Math.max(0, o.interestRate || 0)));
    }
    var base = personalTax(o.salary, o.other, o.dividends, o.year).incomeTax;
    var bikTax = bik > 0 ? personalTax(o.salary + bik, o.other, o.dividends, o.year).incomeTax - base : 0;
    var bikClass1A = class1A(bik, o.year);

    var clearTax = loan > 0 ? personalTax(o.salary, o.other, o.dividends + loan, o.year).incomeTax - base : 0;

    return {
      loan: loan,
      s455: s455,
      s455Rate: C.s455Rate,
      dueDate: dueDate,
      benefit: bik,
      benefitTax: bikTax,
      benefitClass1A: bikClass1A,
      officialRate: C.officialRate,
      threshold: C.loanBenefitThreshold,
      clearByDividendTax: clearTax,
      firstYearCost: s455 + bikTax + bikClass1A
    };
  }

  /* Appropriate percentage for a company car registered from 06/04/2020.
     fuel: "petrol" (also hybrid and electric), "diesel", "dieselRDE2". */
  function carPercentage(co2, electricRange, fuel, year) {
    var K = rates(year).car;
    co2 = Math.max(0, Math.round(num(co2)));
    var pct;
    if (co2 === 0) {
      pct = K.zero;
    } else if (co2 <= 50) {
      var r = Math.max(0, num(electricRange));
      pct = K.range[K.range.length - 1][1];
      for (var i = 0; i < K.range.length; i++) { if (r >= K.range[i][0]) { pct = K.range[i][1]; break; } }
    } else {
      pct = K.bands[0][1];
      for (var j = 0; j < K.bands.length; j++) { if (co2 >= K.bands[j][0]) pct = K.bands[j][1]; }
    }
    if (fuel === "diesel") pct += K.dieselSupplement;
    return Math.min(K.max, pct);
  }

  /* Company car benefit and the tax on it. Extra income (the benefit) sits
     on top of salary as non-savings income, so its tax is the difference in
     the whole personal tax bill with and without it, which also picks up any
     dividends pushed into a higher band. */
  function companyCar(o) {
    var C = rates(o.year), K = C.car;
    var pct = carPercentage(o.co2, o.electricRange, o.fuel, o.year);
    var price = Math.max(0, num(o.listPrice) - Math.min(Math.max(0, num(o.capitalContribution)), K.capitalContributionCap));
    var carBenefit = Math.max(0, price * pct - Math.max(0, num(o.privateUsePayment)));
    var fuelBenefit = o.privateFuel ? K.fuelMultiplier * pct : 0;
    var benefit = carBenefit + fuelBenefit;
    var base = personalTax(o.salary, o.other, o.dividends, o.year).incomeTax;
    var tax = personalTax(o.salary + benefit, o.other, o.dividends, o.year).incomeTax - base;
    return {
      percentage: pct,
      priceForBenefit: price,
      carBenefit: carBenefit,
      fuelBenefit: fuelBenefit,
      benefit: benefit,
      tax: tax,
      class1A: class1A(benefit, o.year),
      monthlyTax: tax / 12
    };
  }

  /* Cash car allowance instead. The allowance is salary: Income Tax, employee
     NI and employer NI all apply at the margin. Business mileage paid below
     the approved rate earns mileage allowance relief; paid above it, the
     excess is taxable. Employer NI is shown before the Employment Allowance. */
  function carAllowance(o) {
    var C = rates(o.year), A = C.amap;
    var allowance = Math.max(0, num(o.allowance));
    var miles = Math.max(0, num(o.businessMiles));
    var ratePaid = Math.max(0, num(o.ratePaid));
    var approved = Math.min(miles, A.threshold) * A.first + Math.max(0, miles - A.threshold) * A.after;
    var paid = miles * ratePaid;
    var relief = Math.max(0, approved - paid);
    var excess = Math.max(0, paid - approved);

    var base = personalTax(o.salary, o.other, o.dividends, o.year).incomeTax;
    var taxable = allowance + excess - relief;
    var tax = personalTax(o.salary + taxable, o.other, o.dividends, o.year).incomeTax - base;
    var eeNI = employeeNI(o.salary + allowance + excess, o.year) - employeeNI(o.salary, o.year);
    var erNI = employerNI(o.salary + allowance + excess, o.year, false) - employerNI(o.salary, o.year, false);

    return {
      allowance: allowance,
      approvedMileage: approved,
      mileagePaid: paid,
      mileageRelief: relief,
      taxableExcess: excess,
      tax: tax,
      employeeNI: eeNI,
      employerNI: erNI,
      net: allowance - tax - eeNI,
      monthlyNet: (allowance - tax - eeNI) / 12,
      employerCost: allowance + erNI + paid
    };
  }

  /* =========================================================================
     3) DISCLAIMER BLOCK
     -------------------------------------------------------------------------
     Identical wording on every tool. Board condition, 15/09/2026.
     ========================================================================= */
  function disclaimerHTML(opts) {
    opts = opts || {};
    var year = opts.year || LUVERO_DEFAULT_YEAR;
    var extras = (opts.extraPoints || []).map(function (p) {
      return "<li>" + p + "</li>";
    }).join("");

    /* Corporation Tax is a UK-wide tax, so the Scotland caveat only belongs on
       the tools that touch income tax. */
    var jurisdiction = opts.ukWide
      ? "<li>Figures are for the <strong>" + esc(year) + "</strong> rates. Corporation Tax is the same across the whole of the UK.</li>"
      : "<li>Figures are for the <strong>" + esc(year) + "</strong> tax year, England, Wales and Northern Ireland. " +
        "Scottish income tax rates are not included.</li>";

    return '' +
      '<section class="lv-disclaimer" aria-labelledby="lv-disclaimer-h">' +
        '<h2 id="lv-disclaimer-h">Information, not advice</h2>' +
        '<p>This calculator gives an indicative figure to help you understand how the tax works. ' +
        'It is not tax advice and it is not a personal recommendation. It cannot take account of ' +
        'your full circumstances, and you should not act on it on its own. Confirm your position ' +
        'with your accountant before you make a decision.</p>' +
        '<ul>' +
          jurisdiction +
          '<li>The result is an estimate, not a filed computation. Rounding and figures we have not asked for will move it.</li>' +
          '<li>Nothing you enter is stored unless you choose to give us your email address.</li>' +
          extras +
        '</ul>' +
        '<p class="lv-disclaimer__meta">Rates last checked against GOV.UK on ' + esc(LUVERO_RATES_LAST_CHECKED) + '. ' +
        'Luvero Accounting Ltd is licensed and regulated by AAT under licence number 10113057. ' +
        'Registered in England number 10972036. ' +
        '<a href="/methodology">How the calculators work</a>, ' +
        '<a href="/terms">terms of use</a> and <a href="/privacy">privacy notice</a>.</p>' +
      '</section>';
  }

  function renderDisclaimer(target, opts) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) el.innerHTML = disclaimerHTML(opts);
  }

  /* =========================================================================
     3b) BASIS BLOCK
     -------------------------------------------------------------------------
     Sits directly under the results. Repeats back the figures the visitor
     actually entered and says plainly that the answer is indicative and only
     as good as those figures.
     ========================================================================= */
  function renderBasis(target, opts) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    opts = opts || {};
    var items = (opts.items || []).map(function (i) {
      return "<tr><th>" + esc(i[0]) + "</th><td>" + i[1] + "</td></tr>";
    }).join("");

    el.innerHTML =
      '<section class="lv-basis" aria-labelledby="lv-basis-h">' +
        '<h2 id="lv-basis-h">These figures are indicative</h2>' +
        '<p>They are worked out only from what you entered below, using the ' +
        esc(opts.year || LUVERO_DEFAULT_YEAR) + ' rates. Change any of it and the answer changes. ' +
        'Anything you have not told us, and anything the calculator does not ask about, is not in the result.</p>' +
        '<div class="lv-table-scroll"><table class="lv-table lv-basis__table"><tbody>' + items + '</tbody></table></div>' +
      '</section>';
  }

  /* =========================================================================
     3c) ACTIONS BLOCK
     -------------------------------------------------------------------------
     Save as PDF, and a way to reach a human. On every tool.
     ========================================================================= */
  function renderActions(target, opts) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    opts = opts || {};

    el.innerHTML =
      '<section class="lv-actions lv-no-print" aria-labelledby="lv-actions-h">' +
        '<div class="lv-actions__col">' +
          '<h2 id="lv-actions-h">Take your results away</h2>' +
          '<p>Save the whole page, working and all, as a PDF you can keep or send on. ' +
          'This opens your browser print window: choose <strong>Save as PDF</strong> as the destination.</p>' +
          '<button type="button" class="lv-btn" onclick="window.print()">Download as PDF</button>' +
        '</div>' +
        '<div class="lv-actions__col lv-actions__col--talk">' +
          '<h2>Want someone to look at it properly?</h2>' +
          '<p>A calculator cannot see the rest of your position. If you want these figures checked against ' +
          'your actual accounts, or you are weighing up a decision, put your name on our waiting list and ' +
          'we will come back to you.</p>' +
          '<p class="lv-actions__contact">' +
            /* The waiting list form, not a general contact page. Luvero is on a
               closed-intake model, so this is where enquiries actually go. */
            '<a class="lv-btn lv-btn--quiet" href="' + PARENT_SITE + '/waitlist#form">Join the waiting list</a>' +
            '<span>or email <a href="mailto:admin@luveroaccounting.co.uk">admin@luveroaccounting.co.uk</a>, ' +
            'call <a href="tel:+441302613515">01302 613515</a>, ' +
            'or WhatsApp <a href="https://wa.me/447378312288">07378 312288</a>.</span>' +
          '</p>' +
        '</div>' +
      '</section>';
  }

  /* =========================================================================
     4) CAPTURE BLOCK
     -------------------------------------------------------------------------
     Results are always shown in full above this. The email is optional and is
     only ever offered in exchange for a PDF copy.

     The form itself is the ClientMax form "Tools site capture", embedded as an
     iframe. It is not a hand-rolled form posting to a webhook: the ClientMax
     inbound webhook is a premium trigger that charges per execution, and the
     board condition is no further spend. A standard form costs nothing.

     ClientMax records the submission, and the workflow "Tools site capture
     (tools-lead)" adds the tools-lead tag.
     ========================================================================= */
  var CAPTURE_FORM_ID  = "u7jw08GNpBgyjY68Rfru";
  var CAPTURE_FORM_SRC = "https://api.leadconnectorhq.com/widget/form/" + CAPTURE_FORM_ID;
  var CAPTURE_EMBED_JS = "https://link.msgsndr.com/js/form_embed.js";

  function captureHTML(opts) {
    opts = opts || {};
    var tool = opts.tool || "Tool";
    var frameId = "inline-" + CAPTURE_FORM_ID;

    return '' +
      '<section class="lv-capture lv-no-print" aria-labelledby="lv-capture-h" data-tool="' + esc(tool) + '">' +
        '<h2 id="lv-capture-h">Want someone to check these numbers?</h2>' +
        '<p>The button above saves this page as a PDF, your figures and all the working included. ' +
        'That copy is yours and we never see it.</p>' +
        '<p>If you would like us to look at your position properly, against your actual accounts ' +
        'rather than four boxes on a screen, leave your details and we will get in touch.</p>' +
        '<div class="lv-capture__embed">' +
          '<iframe src="' + CAPTURE_FORM_SRC + '" ' +
            'id="' + frameId + '" ' +
            'title="Email me a copy" ' +
            'style="width:100%;height:520px;border:none;border-radius:10px" ' +
            "data-layout=\"{'id':'INLINE'}\" " +
            'data-trigger-type="alwaysShow" ' +
            'data-trigger-value="" ' +
            'data-activation-type="alwaysActivated" ' +
            'data-activation-value="" ' +
            'data-deactivation-type="neverDeactivate" ' +
            'data-deactivation-value="" ' +
            'data-form-name="Tools site capture" ' +
            'data-height="498" ' +
            'data-layout-iframe-id="' + frameId + '" ' +
            'data-form-id="' + CAPTURE_FORM_ID + '" ' +
            'data-cookie-consent="true" ' +
            'data-cookie-consent-provider="auto">' +
          '</iframe>' +
        '</div>' +
        '<p class="lv-capture__consent">We will use your details to reply to you. ' +
        'We will only send anything else if you tick the box. The figures you typed into the ' +
        'calculator are not sent with this and we never see them. What we hold and for how long is ' +
        'set out in our <a href="/privacy">privacy notice</a>.</p>' +
      '</section>';
  }

  /* The embed script has to be added with createElement. A <script> tag written
     through innerHTML is parsed but never executed, which is the same trap that
     stopped the head code working. */
  function loadCaptureEmbedScript() {
    if (document.querySelector('script[src="' + CAPTURE_EMBED_JS + '"]')) return;
    var s = document.createElement("script");
    s.src = CAPTURE_EMBED_JS;
    s.async = true;
    document.body.appendChild(s);
  }

  function renderCapture(target, opts) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    el.innerHTML = captureHTML(opts);
    loadCaptureEmbedScript();
  }

  /* =========================================================================
     5) HEADER AND FOOTER
     ========================================================================= */
  function headerHTML(toolName) {
    return '' +
      '<header class="lv-header">' +
        '<div class="lv-header__inner">' +
          /* The negative (white) wordmark, because the header sits on the purple
             gradient. The artwork is embedded in luvero.css as a data URI, so
             nothing has to be uploaded before the site works. */
          '<a class="lv-brand" href="/">' +
            '<span class="lv-brand__logo" role="img" aria-label="Luvero"></span>' +
            '<span class="lv-brand__text">' +
              '<span class="lv-brand__name">Business Tax Calculator</span>' +
              '<span class="lv-brand__sub">' + esc(toolName || "Free tools from Luvero") + '</span>' +
            '</span>' +
          '</a>' +
          '<button type="button" class="lv-btn lv-btn--ghost lv-no-print" onclick="window.print()">Print or save as PDF</button>' +
        '</div>' +
      '</header>';
  }

  function footerHTML() {
    var yr = new Date().getFullYear();
    return '' +
      '<footer class="lv-footer">' +
        '<div class="lv-footer__inner">' +
          '<div>' +
            /* Professional designation: AAT Licensed Accountant, licence 10113057.
               Taken from the AAT pack recorded in BRAND.md and from the notice on
               luvero.uk. Do not substitute any other title. */
            'Built by <a href="' + PARENT_SITE + '">Luvero Accounting</a>, accountants in Bawtry. ' +
            'Luvero Accounting Ltd is licensed and regulated by AAT under licence number 10113057. ' +
            'Registered in England number 10972036. ' +
            '&copy; ' + yr + '.' +
          '</div>' +
          '<nav aria-label="Footer">' +
            '<a href="/methodology">How the calculators work</a>' +
            '<a href="/privacy">Privacy notice</a>' +
            '<a href="/terms">Terms of use</a>' +
            '<a href="' + PARENT_SITE + '">luvero.uk</a>' +
          '</nav>' +
        '</div>' +
      '</footer>';
  }

  function renderChrome(toolName) {
    var h = document.querySelector("[data-lv-header]");
    if (h) h.outerHTML = headerHTML(toolName);
    var f = document.querySelector("[data-lv-footer]");
    if (f) f.outerHTML = footerHTML();
  }

  /* =========================================================================
     6) BAR CHART
     -------------------------------------------------------------------------
     Plain divs rather than SVG or a charting library, so it prints and needs
     no external script on the ClientMax page.
     ========================================================================= */
  function bars(target, parts) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    var total = parts.reduce(function (t, p) { return t + Math.max(0, p.value); }, 0) || 1;
    el.innerHTML = parts.map(function (p) {
      var w = (Math.max(0, p.value) / total) * 100;
      return '<div>' +
        '<div class="lv-bar__label"><span>' + esc(p.label) + '</span>' +
        '<span><strong>' + gbp(p.value) + '</strong> ' + pct(p.value / total, 0) + '</span></div>' +
        '<div class="lv-bar__track"><div class="lv-bar__fill" style="width:' + w.toFixed(2) + '%;background:' + p.colour + '"></div></div>' +
      '</div>';
    }).join("");
  }

  /* =========================================================================
     7) SEO
     -------------------------------------------------------------------------
     ClientMax carries only the body of each page, so the <head> in the source
     files never reaches the live site. Titles and descriptions are set in the
     ClientMax page settings (see SEO-AND-CLIENTMAX-SETTINGS-16-09-2026.md) and
     these helpers repeat them at runtime as a fallback, add the canonical URL
     and inject structured data. Google renders JavaScript, so this is worth
     having, but the server-side settings remain the primary route.
     ========================================================================= */
  var SITE = "https://businesstaxcalculator.co.uk";

  function canonicalPath() {
    var p = (location.pathname || "/").replace(/\/+$/, "").replace(/\.html$/, "");
    /* ClientMax serves the home page at both / and /home, and bounces unknown
       paths to /home. Both spellings canonicalise to the root. */
    if (p === "" || p === "/home" || p === "/index") return "/";
    return p;
  }

  function headTag(selector, create) {
    var el = document.head.querySelector(selector);
    if (!el) { el = create(); document.head.appendChild(el); }
    return el;
  }

  function seo(o) {
    o = o || {};
    if (o.title) document.title = o.title;
    if (o.description) {
      headTag('meta[name="description"]', function () {
        var m = document.createElement("meta"); m.name = "description"; return m;
      }).setAttribute("content", o.description);
    }
    if (o.robots) {
      headTag('meta[name="robots"]', function () {
        var m = document.createElement("meta"); m.name = "robots"; return m;
      }).setAttribute("content", o.robots);
    }
    /* The canonical never carries the query string, so shared links with
       calculator inputs all point back at the one clean URL. */
    headTag('link[rel="canonical"]', function () {
      var l = document.createElement("link"); l.rel = "canonical"; return l;
    }).setAttribute("href", SITE + canonicalPath());
  }

  function schema(obj) {
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(obj);
    document.head.appendChild(s);
  }

  /* Breadcrumb, WebApplication and reviewer, for one calculator page. The
     reviewer details match the trust strip rendered on the same page, so the
     structured data never claims anything the visitor cannot see. */
  function toolSchema(o) {
    var url = SITE + canonicalPath();
    schema({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Business Tax Calculator", "item": SITE + "/" },
        { "@type": "ListItem", "position": 2, "name": o.name, "item": url }
      ]
    });
    schema({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": o.name,
      "url": url,
      "description": o.description || "",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Any",
      "browserRequirements": "Requires JavaScript",
      "isAccessibleForFree": true,
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "GBP" },
      "inLanguage": "en-GB",
      "dateModified": isoFromUK(LUVERO_RATES_LAST_CHECKED),
      "publisher": { "@type": "AccountingService", "name": "Luvero Accounting Ltd", "url": PARENT_SITE },
      "reviewedBy": reviewerSchema()
    });
  }

  function reviewerSchema() {
    return {
      "@type": "Person",
      "name": "Dan Edwards",
      "honorificSuffix": "FMAAT",
      "jobTitle": "Director, AAT Licensed Accountant",
      "worksFor": { "@type": "AccountingService", "name": "Luvero Accounting Ltd", "url": PARENT_SITE }
    };
  }

  function isoFromUK(d) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || "");
    return m ? m[3] + "-" + m[2] + "-" + m[1] : undefined;
  }

  /* FAQPage schema built from the <details> blocks actually on the page, so
     the questions and answers in the markup and the schema cannot drift. */
  function faqSchemaFromDOM(container) {
    var root = typeof container === "string" ? document.querySelector(container) : container;
    if (!root) return;
    var items = [];
    root.querySelectorAll("details").forEach(function (d) {
      var q = d.querySelector("summary"), a = d.querySelector("div");
      if (!q || !a) return;
      items.push({
        "@type": "Question",
        "name": q.textContent.trim(),
        "acceptedAnswer": { "@type": "Answer", "text": a.innerHTML.trim() }
      });
    });
    if (items.length) {
      schema({ "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": items });
    }
  }

  /* =========================================================================
     8) SHAREABLE URLS
     -------------------------------------------------------------------------
     Calculator inputs travel in the query string, so a result can be
     bookmarked or sent on. Only the figures typed into the calculator go in;
     never a name, email or anything from the capture form.
     ========================================================================= */
  function params() {
    return new URLSearchParams(location.search);
  }

  /* Fill inputs from the URL. `map` is { paramName: element }. Text inputs
     get a formatted number, checkboxes a yes/no, selects and dates the raw
     value if it is one of their options. Returns true if anything was set. */
  function fillFromParams(map) {
    var p = params(), any = false;
    Object.keys(map).forEach(function (k) {
      if (!p.has(k)) return;
      var el = map[k], v = p.get(k);
      if (!el) return;
      if (el.type === "checkbox") {
        el.checked = /^(1|true|yes)$/i.test(v); any = true;
      } else if (el.tagName === "SELECT") {
        var ok = Array.prototype.some.call(el.options, function (o) { return o.value === v; });
        if (ok) { el.value = v; any = true; }
      } else if (el.type === "date") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.value = v; any = true; }
      } else {
        var n = num(v);
        el.value = n ? n.toLocaleString("en-GB") : "0"; any = true;
      }
    });
    return any;
  }

  /* Write the current inputs back to the address bar without reloading. */
  function setParams(obj) {
    var p = new URLSearchParams();
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === undefined || v === null || v === "" || v === false) return;
      p.set(k, v === true ? "1" : String(v));
    });
    var q = p.toString();
    var url = location.pathname + (q ? "?" + q : "");
    if (window.history && history.replaceState) {
      try { history.replaceState(null, "", url); } catch (e) { /* file:// and sandboxed frames */ }
    }
  }

  function shareURL() {
    return SITE + canonicalPath() + location.search;
  }

  /* Journey link to another calculator, with inputs pre-filled. */
  function linkTo(path, obj) {
    var p = new URLSearchParams();
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (v === undefined || v === null || v === "" || v === false) return;
      p.set(k, v === true ? "1" : String(Math.round(Number(v)) || v));
    });
    var q = p.toString();
    return path + (q ? "?" + q : "");
  }

  /* =========================================================================
     9) RESULT CARD
     -------------------------------------------------------------------------
     The headline answer, with copy, share, email and PDF actions. The email
     action only scrolls to the capture form further down the page; the
     result is always on screen before any email is asked for.
     ========================================================================= */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  function renderResult(target, o) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    o = o || {};
    var rows = (o.rows || []).map(function (r, i) {
      return '<div class="lv-result__row' + (i === 0 ? " lv-result__row--lead" : "") + '">' +
        '<span class="lv-result__label">' + r[0] + '</span>' +
        '<span class="lv-result__value">' + r[1] + '</span></div>';
    }).join("");

    el.innerHTML =
      '<section class="lv-result" aria-labelledby="lv-result-h">' +
        '<h2 class="lv-result__title" id="lv-result-h">' + esc(o.title || "Your result") + '</h2>' +
        '<div class="lv-result__grid">' + rows + '</div>' +
        (o.note ? '<p class="lv-result__note">' + o.note + '</p>' : "") +
        '<div class="lv-result__actions lv-no-print">' +
          '<button type="button" class="lv-btn lv-btn--sm" data-act="copy">Copy result</button>' +
          '<button type="button" class="lv-btn lv-btn--quiet lv-btn--sm" data-act="share">Share calculation</button>' +
          (o.emailTarget ? '<button type="button" class="lv-btn lv-btn--quiet lv-btn--sm" data-act="email">Email result</button>' : "") +
          '<button type="button" class="lv-btn lv-btn--quiet lv-btn--sm" data-act="pdf">Save as PDF</button>' +
          '<span class="lv-result__toast" role="status" hidden></span>' +
        '</div>' +
      '</section>';

    var toast = el.querySelector(".lv-result__toast");
    function say(msg) {
      toast.textContent = msg; toast.hidden = false;
      clearTimeout(say.t); say.t = setTimeout(function () { toast.hidden = true; }, 3500);
    }

    /* Plain-text version of the card, for the clipboard. */
    function asText() {
      var lines = [o.title || "Your result"];
      (o.rows || []).forEach(function (r) {
        lines.push(stripTags(r[0]) + ": " + stripTags(r[1]));
      });
      lines.push("");
      lines.push("Indicative figures, " + (o.year || LUVERO_DEFAULT_YEAR) + " rates. Not advice.");
      lines.push(shareURL());
      return lines.join("\n");
    }

    el.querySelector('[data-act="copy"]').addEventListener("click", function () {
      copyText(asText()).then(function () { say("Copied"); }, function () { say("Could not copy on this browser"); });
    });
    el.querySelector('[data-act="share"]').addEventListener("click", function () {
      var url = shareURL();
      if (navigator.share) {
        navigator.share({ title: o.title || document.title, url: url }).catch(function () {});
      } else {
        copyText(url).then(function () { say("Link copied"); }, function () { say(url); });
      }
    });
    var em = el.querySelector('[data-act="email"]');
    if (em) em.addEventListener("click", function () {
      var t = document.querySelector(o.emailTarget);
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    el.querySelector('[data-act="pdf"]').addEventListener("click", function () { window.print(); });
  }

  function stripTags(s) {
    var d = document.createElement("div"); d.innerHTML = String(s); return d.textContent || "";
  }

  /* =========================================================================
     10) LUVERO CALL TO ACTION AND JOURNEY LINK
     -------------------------------------------------------------------------
     One conversion point per page, sitting directly under the result, with
     wording that changes according to what the result shows. The link goes to
     the waiting list form, which is where Luvero takes enquiries. `src` tags
     the link so enquiries can be traced back to a calculator without any
     analytics on this site.
     ========================================================================= */
  function ctaHref(src) {
    return PARENT_SITE + "/waitlist?src=btc-" + encodeURIComponent(src || "tool") + "#form";
  }

  function renderCTA(target, o) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    o = o || {};
    el.innerHTML =
      '<aside class="lv-cta lv-no-print">' +
        '<p>' + o.text + '</p>' +
        '<a class="lv-btn" href="' + ctaHref(o.src) + '">' + esc(o.button) + '</a>' +
      '</aside>';
  }

  function renderNext(target, o) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    o = o || {};
    el.innerHTML =
      '<section class="lv-next lv-no-print" aria-labelledby="lv-next-h">' +
        '<div class="lv-next__text">' +
          '<h2 id="lv-next-h">' + esc(o.heading || "What to look at next") + '</h2>' +
          '<p>' + o.text + '</p>' +
        '</div>' +
        '<a class="lv-btn" href="' + o.href + '">' + esc(o.label) + '</a>' +
      '</section>';
  }

  /* =========================================================================
     11) TRUST STRIP
     -------------------------------------------------------------------------
     Who built it, who reviewed it, when the rates were last checked, and the
     official sources. Same on every calculator; the sources vary by tool.
     ========================================================================= */
  var SOURCES = {
    ct:   ["https://www.gov.uk/government/publications/rates-and-allowances-corporation-tax", "Corporation Tax rates and allowances (GOV.UK)"],
    mr:   ["https://www.gov.uk/guidance/corporation-tax-marginal-relief", "Marginal relief for Corporation Tax (GOV.UK)"],
    ac:   ["https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03940", "Associated companies, HMRC Company Taxation Manual"],
    it:   ["https://www.gov.uk/government/publications/rates-and-allowances-income-tax", "Income Tax rates and allowances (GOV.UK)"],
    div:  ["https://www.gov.uk/tax-on-dividends", "Tax on dividends (GOV.UK)"],
    ni:   ["https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027", "Rates and thresholds for employers 2026 to 2027 (GOV.UK)"],
    ea:   ["https://www.gov.uk/claim-employment-allowance", "Employment Allowance (GOV.UK)"],
    pa:   ["https://www.gov.uk/income-tax-rates", "Income Tax rates and Personal Allowances (GOV.UK)"],
    pay:  ["https://www.gov.uk/pay-corporation-tax", "Pay your Corporation Tax bill (GOV.UK)"],
    se:   ["https://www.gov.uk/self-employed-national-insurance-rates", "Self-employed National Insurance rates (GOV.UK)"],
    nic:  ["https://www.gov.uk/government/publications/rates-and-allowances-national-insurance-contributions", "Rates and allowances: National Insurance contributions (GOV.UK)"],
    sl:   ["https://www.gov.uk/repaying-your-student-loan/what-you-pay", "Repaying your student loan: what you pay (GOV.UK)"],
    bik:  ["https://www.gov.uk/tax-company-benefits", "Tax on company benefits (GOV.UK)"],
    st:   ["https://www.gov.uk/set-up-sole-trader", "Set up as a sole trader (GOV.UK)"],
    ltd:  ["https://www.gov.uk/limited-company-formation", "Set up a limited company (GOV.UK)"],
    mtd:  ["https://www.gov.uk/guidance/use-making-tax-digital-for-income-tax", "Making Tax Digital for Income Tax (GOV.UK)"],
    eaw:  ["https://www.gov.uk/claim-employment-allowance", "Claim Employment Allowance (GOV.UK)"],
    dla:  ["https://www.gov.uk/directors-loans", "Director's loans (GOV.UK)"],
    orate: ["https://www.gov.uk/government/publications/rates-and-allowances-beneficial-loan-arrangements-hmrc-official-rates", "HMRC official rates for beneficial loans (GOV.UK)"],
    car:  ["https://www.gov.uk/guidance/company-car-benefit-the-appropriate-percentage-480-appendix-2", "Company car benefit: the appropriate percentage (GOV.UK)"],
    fuel: ["https://www.gov.uk/government/publications/increase-to-van-benefit-charge-and-fuel-benefit-charges-for-cars-and-vans", "Van benefit and fuel benefit charges from 6 April 2026 (GOV.UK)"],
    amap: ["https://www.gov.uk/expenses-and-benefits-business-travel-mileage/rules-for-tax", "Business travel mileage: rules for tax (GOV.UK)"]
  };

  function renderTrust(target, keys) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    var links = (keys || []).map(function (k) {
      var s = SOURCES[k]; if (!s) return "";
      return '<li><a href="' + s[0] + '" rel="noopener" target="_blank">' + esc(s[1]) + '</a></li>';
    }).join("");

    el.innerHTML =
      '<section class="lv-trust" aria-labelledby="lv-trust-h">' +
        '<p class="lv-trust__title" id="lv-trust-h">Built and reviewed by Luvero Accounting</p>' +
        '<ul>' +
          '<li>Reviewed by Dan Edwards FMAAT</li>' +
          '<li>AAT licensed accountancy practice, Bawtry, South Yorkshire</li>' +
          '<li>Tax rates last reviewed ' + esc(LUVERO_RATES_LAST_CHECKED) + '</li>' +
          '<li><a href="/methodology">How the calculators work</a></li>' +
        '</ul>' +
        (links ? '<div class="lv-trust__sources">Sources: <ul>' + links + '</ul></div>' : "") +
      '</section>';
  }

  /* The compact strip under the page heading. */
  function stripHTML(extra) {
    var items = [LUVERO_DEFAULT_YEAR + " UK rates", "Rates checked " + LUVERO_RATES_LAST_CHECKED, "No sign-up required"]
      .concat(extra || []);
    return '<p class="lv-strip">' + items.map(function (i) { return "<span>" + esc(i) + "</span>"; }).join("") + "</p>";
  }

  function renderStrip(target, extra) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (el) el.outerHTML = stripHTML(extra);
  }

  /* =========================================================================
     PUBLIC INTERFACE
     ========================================================================= */
  return {
    num: num, gbp: gbp, gbpExact: gbpExact, pct: pct, esc: esc, clamp: clamp,
    rates: rates, years: years, bindMoneyInput: bindMoneyInput,

    personalAllowance: personalAllowance,
    personalTax: personalTax,
    employeeNI: employeeNI,
    employerNI: employerNI,
    corporationTax: corporationTax,
    corporationTaxDetail: corporationTaxDetail,
    periodDays: periodDays,
    periodFraction: periodFraction,
    profitForDividend: profitForDividend,
    extraction: extraction,
    candidateSalaries: candidateSalaries,
    dividendForNet: dividendForNet,
    routeForTarget: routeForTarget,
    class4NI: class4NI,
    class2Position: class2Position,
    soleTrader: soleTrader,
    companyRoute: companyRoute,
    breakevenProfit: breakevenProfit,
    dividendBands: dividendBands,
    studentLoan: studentLoan,
    class1A: class1A,
    payrollEmployerNI: payrollEmployerNI,
    addMonthsAndDays: addMonthsAndDays,
    directorsLoan: directorsLoan,
    carPercentage: carPercentage,
    companyCar: companyCar,
    carAllowance: carAllowance,

    disclaimerHTML: disclaimerHTML,
    renderDisclaimer: renderDisclaimer,
    renderBasis: renderBasis,
    renderActions: renderActions,
    captureHTML: captureHTML,
    renderCapture: renderCapture,
    renderChrome: renderChrome,
    bars: bars,

    seo: seo, schema: schema, toolSchema: toolSchema, faqSchemaFromDOM: faqSchemaFromDOM,
    params: params, fillFromParams: fillFromParams, setParams: setParams,
    shareURL: shareURL, linkTo: linkTo,
    renderResult: renderResult, renderCTA: renderCTA, renderNext: renderNext,
    renderTrust: renderTrust, renderStrip: renderStrip, ctaHref: ctaHref,

    CAPTURE_TAG: CAPTURE_TAG,
    PARENT_SITE: PARENT_SITE,
    SITE: SITE
  };

})();
