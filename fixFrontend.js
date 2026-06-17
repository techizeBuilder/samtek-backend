const fs = require('fs');
const file = 'D:/Samtek/Samtek-Frontend/client/src/pages/sales/Leads.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/\{lead\.quotation \? \(/g, '{lead.hasQuotation ? (');

content = content.replace(
  /onClick=\{\(\) => \{\s*const base64String = lead\.quotation;\s*if \(base64String\.startsWith\('data:application\\/pdf'\)\) \{\s*const win = window\.open\(\);\s*win\.document\.write\([\s\S]*?link\.click\(\);\s*\}\s*\}\}/,
  onClick={async () => {
                                try {
                                  const response = await leadApi.getById(lead._id);
                                  const base64String = response.lead?.quotation || response.data?.lead?.quotation;
                                  if (base64String && base64String.startsWith('data:application/pdf')) {
                                    const win = window.open();
                                    win.document.write(\<iframe src="\" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>\);
                                    const link = document.createElement('a');
                                    link.href = base64String;
                                    link.download = \Quotation_\.pdf\;
                                    link.click();
                                  } else {
                                    toast({ title: "Error", description: "Invalid quotation format.", variant: "destructive" });
                                  }
                                } catch (error) {
                                  toast({ title: "Error", description: "Failed to load quotation.", variant: "destructive" });
                                }
                              }}
);

content = content.replace(/\{lead\.quotation \? 'Update Quotation' : 'Send Quotation'\}/g, '{lead.hasQuotation ? \\'Update Quotation\\' : \\'Send Quotation\\'}');
content = content.replace(/if \(!lead\.quotation\)/g, 'if (!lead.hasQuotation)');

fs.writeFileSync(file, content, 'utf8');
console.log('Frontend Leads.jsx updated!');