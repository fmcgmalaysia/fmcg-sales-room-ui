const fs=require('node:fs'),assert=require('node:assert/strict');
const file='.github/workflows/pages-v64-same-origin.yml';let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
assert(!source.includes('quotation-buyer-followup-only'));
source=source.replace('          - catalogue-complete-only','          - catalogue-complete-only\n          - quotation-buyer-followup-only');
const first="        if: inputs.static_ui != 'catalogue-complete-only'";assert(source.includes(first));
source=source.replace(first,"        if: inputs.static_ui != 'quotation-buyer-followup-only' && inputs.static_ui != 'catalogue-complete-only'");
const anchor='      - name: Deploy to GitHub Pages';assert.equal(source.split(anchor).length,2);
const block=`      - name: Download verified current Pages for quotation and Buyer follow-ups
        if: github.event_name == 'workflow_dispatch' && inputs.static_ui == 'quotation-buyer-followup-only'
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: github-pages
          run-id: 44453020525
          github-token: \${{ github.token }}
          path: \${{ format('{0}/quote-followup-baseline', runner.temp) }}

      - name: Test and stage only approved quotation, order sorting and portal changes
        if: github.event_name == 'workflow_dispatch' && inputs.static_ui == 'quotation-buyer-followup-only'
        run: |
          site="$RUNNER_TEMP/quote-followup-site"
          mkdir "$site"
          tar --extract --file "$RUNNER_TEMP/quote-followup-baseline/artifact.tar" --directory "$site"
          node --test integration/prototypes/quote-published-date-20261119/check.cjs integration/prototypes/web-quotations/wix-publication-data.test.cjs tests/buyer-visible-quotes-read.test.cjs integration/tests/ltpos-managed-workspaces.test.cjs integration/tests/ltpos-portal-origin.test.cjs
          node integration/releases/stage-quote-date-order-brand.cjs "$site"

      - name: Upload verified quotation and Buyer follow-up package
        if: github.event_name == 'workflow_dispatch' && inputs.static_ui == 'quotation-buyer-followup-only'
        uses: actions/upload-pages-artifact@v5
        with:
          path: \${{ format('{0}/quote-followup-site', runner.temp) }}

`;
fs.writeFileSync(file,source.replace(anchor,block+anchor));
