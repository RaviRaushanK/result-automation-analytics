(function(){
  'use strict';
  document.querySelectorAll('[data-password-toggle]').forEach(button=>button.addEventListener('click',()=>{
    const input=document.getElementById(button.dataset.passwordToggle);
    const show=input.type==='password';input.type=show?'text':'password';
    button.setAttribute('aria-pressed',String(show));
    button.setAttribute('aria-label',(show?'Hide ':'Show ')+(input.name==='confirmPassword'?'confirm password':'password'));
    button.querySelector('.material-icons').textContent=show?'visibility_off':'visibility';
  }));
  document.querySelectorAll('.registration-card form').forEach(form=>{
    const fields=Array.from(form.querySelectorAll('input:not([type="hidden"])')).filter(input=>!input.readOnly);
    if(!fields.length)return;
    form.classList.add('needs-validation');
    form.noValidate=true;
    const feedback=new Map();
    fields.forEach(input=>{
      const message=document.createElement('div');
      message.id=input.id+'-feedback';message.className='invalid-feedback';
      message.setAttribute('aria-live','polite');message.hidden=true;
      const wrapper=input.closest('.registration-password');
      (wrapper||input).insertAdjacentElement('afterend',message);
      input.setAttribute('aria-describedby',message.id);feedback.set(input,message);
    });
    function update(){
      const password=form.querySelector('[name="password"]');
      const confirm=form.querySelector('[name="confirmPassword"]');
      if(password)password.setCustomValidity(new TextEncoder().encode(password.value).length>72?'Use a password of at most 72 UTF-8 bytes.':'');
      if(confirm)confirm.setCustomValidity(confirm.value!==password.value?'The passwords do not match.':'');
      fields.forEach(input=>{
        const invalid=!input.validity.valid;
        const messages={username:'Use 3–50 letters, numbers, dots, underscores or hyphens.',password:'Use at least 12 characters (maximum 72 UTF-8 bytes).',confirmPassword:'Re-enter the same password.',otp:'Enter the 6-digit verification code.'};
        const message=feedback.get(input);
        message.textContent=input.validity.customError?input.validationMessage:(messages[input.name]||'Please complete this field.');
        message.hidden=!invalid;message.classList.toggle('d-block',invalid);
        input.classList.toggle('is-invalid',invalid);input.classList.toggle('is-valid',!invalid);
        input.setAttribute('aria-invalid',String(invalid));
      });
    }
    form.addEventListener('submit',event=>{
      update();form.classList.add('was-validated');
      if(!form.checkValidity()){event.preventDefault();event.stopPropagation();fields.find(input=>!input.validity.valid)?.focus();}
    });
    fields.forEach(input=>{
      input.addEventListener('blur',()=>{if(input.value||form.classList.contains('was-validated'))update();});
      input.addEventListener('input',()=>{if(form.classList.contains('was-validated')||input.classList.contains('is-invalid'))update();});
    });
  });
})();
