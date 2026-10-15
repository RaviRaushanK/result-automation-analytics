const { randomUUID: uuid } = require('crypto');

module.exports = async ({ sequelize, DataTypes }) => {
  const Department = require('../database/models/Department')(sequelize, DataTypes);

  const [department, created] = await Department.findOrCreate({
    where: { department_code: 'MCA' },
    defaults: {
      department_uuid: uuid(),
      department_code: 'MCA',
      department_name: 'Master of Computer Applications',
      description: 'MCA Department',
      status: 'active'
    }
  });

  if (created) {
    console.log('Default MCA department created successfully.');
    return;
  }

  console.log(`Default MCA department already exists. Skipping creation. id=${department.department_id}`);
};
