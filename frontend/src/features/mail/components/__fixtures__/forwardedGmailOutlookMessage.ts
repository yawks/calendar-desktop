// Regression fixture based on “Fwd: Votre message sur Vicinorum pour la
// copropriété Residence le Lac”. It preserves the nesting that triggered the
// blank iframe: a Gmail signature followed by a forwarded Gmail container
// whose body is Outlook-generated HTML.
export const forwardedGmailOutlookHtml = `
<div dir="ltr">
  <div><br clear="all"></div>
  <div>
    <div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">
      <div dir="ltr">
        <div style="color:rgb(34,34,34)">Cordialement</div>
        <div style="color:rgb(34,34,34)">Jérôme</div>
        <div><img src="https://backend.vicinorum.com/images/vicinorum-PROD.svg" width="96" height="23"></div>
      </div>
    </div>
  </div>
  <br><br>
  <div class="gmail_quote gmail_quote_container">
    <div dir="ltr" class="gmail_attr">
      ---------- Forwarded message ---------<br>
      De : <strong class="gmail_sendername" dir="auto">Théo BOMPARD</strong>
      &lt;<a href="mailto:contact@example.test">contact@example.test</a>&gt;<br>
      Date: lun. 31 août 2026 à 12:17<br>
      Subject: Re: Votre message sur Vicinorum<br>
      To: jerome@example.test
    </div>
    <br><br>
    <div class="msg-2084865520475215712">
      <div lang="FR" link="blue" vlink="purple" style="word-wrap:break-word">
        <div class="m_-2084865520475215712WordSection1">
          <p class="MsoNormal"><span style="font-size:11pt;font-family:Arial,sans-serif">Bonjour,</span></p>
          <p class="MsoNormal"><span style="font-size:11pt;font-family:Arial,sans-serif">Pour le coup je ne suis pas intéressé. Les copropriétaires utilisent déjà leur groupe.</span></p>
          <p class="MsoNormal"><span style="font-size:11pt;font-family:Arial,sans-serif">Bonne journée à vous.</span></p>
          <div style="border:none;border-top:solid #b5c4df 1pt;padding:3pt 0 0">
            <p class="MsoNormal"><b>De :</b> jerome@example.test<br><b>Date :</b> lundi 31 août 2026 à 11:11<br><b>À :</b> Théo BOMPARD<br><b>Objet :</b> Votre message sur Vicinorum</p>
          </div>
          <p class="MsoNormal">Bonjour,<br><br>Je vous contacte au sujet de la copropriété Residence le Lac.<br><br>Cordialement<br>Jérôme</p>
        </div>
      </div>
    </div>
  </div>
</div>`;

export const forwardedGmailOutlookText = `Cordialement
Jérôme

---------- Forwarded message ---------
De : Théo BOMPARD <contact@example.test>
Date: lun. 31 août 2026 à 12:17
Subject: Re: Votre message sur Vicinorum

Bonjour,

Pour le coup je ne suis pas intéressé. Les copropriétaires utilisent déjà leur groupe.`;
