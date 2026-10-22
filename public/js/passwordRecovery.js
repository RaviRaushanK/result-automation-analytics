(function(){
  const button=document.getElementById('recovery-resend'),status=document.getElementById('recovery-resend-status');
  if(!button)return;
  let remaining=Number(button.dataset.wait)||60;
  function countdown(){button.disabled=remaining>0;button.textContent=remaining>0?'Resend code in '+remaining+'s':'Resend code';if(remaining>0){remaining--;setTimeout(countdown,1000);}}
  countdown();
  button.addEventListener('click',async()=>{
    button.disabled=true;status.textContent='Sending a new code…';
    try{
      const response=await fetch('/resend-otp',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({adminId:button.dataset.adminId,type:'password_reset'})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'Unable to resend the code.');
      status.textContent='A new code has been sent to your email.';remaining=data.resendInSeconds||60;countdown();
    }catch(error){status.textContent=error.message;button.disabled=false;}
  });
})();
