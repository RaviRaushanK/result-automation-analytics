(function(){
  const country=document.getElementById('account-country'),list=document.getElementById('account-countries'),mobile=document.getElementById('new-mobile');
  if(!country||!list||!mobile)return;
  list.replaceChildren(...window.registrationCountries.map(item=>{const option=document.createElement('option');option.value=item.label;return option;}));
  function check(){
    const selection=window.registrationCountries.find(item=>item.label===country.value);
    country.setCustomValidity(selection?'':'Select a country and calling code from the suggestions.');
    const valid=Boolean(selection)&&/^\+[1-9]\d{7,14}$/.test(selection.dial+mobile.value);
    mobile.setCustomValidity(valid?'':'Enter a valid mobile number without the country code.');
    mobile.classList.toggle('is-invalid',!valid);mobile.setAttribute('aria-invalid',String(!valid));
    const feedback=document.getElementById('new-mobile-error');
    feedback.textContent=valid?'':'Select a country and enter your mobile number using digits only, without the country code.';
  }
  [country,mobile].forEach(input=>{input.addEventListener('input',check);input.addEventListener('change',check);input.addEventListener('invalid',check);});
  country.form.addEventListener('submit',event=>{check();if(!country.form.checkValidity()){event.preventDefault();country.form.reportValidity();}});
})();
